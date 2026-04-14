/*
Copyright 2024 New Vector Ltd.
Copyright 2020 The Matrix.org Foundation C.I.C.
Copyright 2019 Michael Telatynski <7t3chguy@gmail.com>
Copyright 2018, 2019 New Vector Ltd
Copyright 2017 Vector Creations Ltd
Copyright 2015, 2016 OpenMarket Ltd

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// To ensure we load the browser-matrix version first
import "matrix-js-sdk/src/browser-index";
import React, { type ReactElement, StrictMode } from "react";
import { logger } from "matrix-js-sdk/src/logger";
import { AutoDiscovery, type ClientConfig } from "matrix-js-sdk/src/matrix";
import { WrapperLifecycle, type WrapperOpts } from "@matrix-org/react-sdk-module-api/lib/lifecycles/WrapperLifecycle";

import type { QueryDict } from "matrix-js-sdk/src/utils";
import PlatformPeg from "../PlatformPeg";
import AutoDiscoveryUtils from "../utils/AutoDiscoveryUtils";
import * as Lifecycle from "../Lifecycle";
import SdkConfig from "../SdkConfig";
import { type IConfigOptions } from "../IConfigOptions";
import { SnakedObject } from "../utils/SnakedObject";
import MatrixChat from "../components/structures/MatrixChat";
import { type ValidatedServerConfig } from "../utils/ValidatedServerConfig";
import { ModuleRunner } from "../modules/ModuleRunner";
import { parseQs } from "./url_utils";
import { getInitialScreenAfterLogin, getScreenFromLocation, init as initRouting, onNewScreen } from "./routing";
import { UserFriendlyError } from "../languageHandler";
import { ModuleApi } from "../modules/Api";
import { RoomView } from "../components/structures/RoomView";
import RoomAvatar from "../components/views/avatars/RoomAvatar";
import { ModuleNotificationDecoration } from "../modules/components/ModuleNotificationDecoration";
import Login from "../Login.ts";
import { startOidcLogin } from "../utils/oidc/authorize.ts";

logger.log(`Application is running in ${process.env.NODE_ENV} mode`);

window.matrixLogger = logger;

function onTokenLoginCompleted(): void {
    // if we did a token login, we're now left with the token, hs and is
    // url as query params in the url;
    // if we did an oidc authorization code flow login, we're left with the auth code and state
    // as query params in the url;
    // a little nasty but let's redirect to clear them.
    const url = new URL(window.location.href);

    url.searchParams.delete("no_universal_links");
    url.searchParams.delete("loginToken");
    url.searchParams.delete("state");
    url.searchParams.delete("code");

    logger.log(`Redirecting to ${url.href} to drop delegated authentication params from queryparams`);
    window.history.replaceState(null, "", url.href);
}

async function redirectToSso(config: ValidatedServerConfig): Promise<boolean> {
    logger.log("Bypassing app load to redirect to SSO");

    try {
        const login = new Login(config.hsUrl, config.isUrl, null, {
            delegatedAuthentication: config.delegatedAuthentication,
        });
        const flows = await login.getFlows();

        const nativeOidcFlow = flows.find((flow) => "clientId" in flow);
        if (nativeOidcFlow && config.delegatedAuthentication) {
            await startOidcLogin(config.delegatedAuthentication, nativeOidcFlow.clientId, config.hsUrl, config.isUrl);
            return true;
        }

        const flow = flows.find((flow) => flow.type === "m.login.sso" || flow.type === "m.login.cas");
        PlatformPeg.get()!.startSingleSignOn(
            login.createTemporaryClient(),
            flow?.type === "m.login.cas" ? "cas" : "sso",
            `/${getScreenFromLocation(window.location).screen}`,
        );
        return true;
    } catch (e) {
        console.error("Error encountered during sso redirect", e);
    }

    return false;
}

export async function loadApp(fragParams: QueryDict, matrixChatRef: React.Ref<MatrixChat>): Promise<ReactElement> {
    // XXX: This lives here because certain components import so many things that importing it in a sensible place (eg.
    // the builtins module or init.tsx) causes a circular dependency.
    ModuleApi.instance.builtins.setComponents({
        roomView: RoomView,
        roomAvatar: RoomAvatar,
        notificationDecoration: ModuleNotificationDecoration,
    });

    initRouting();
    const platform = PlatformPeg.get();

    const params = parseQs(window.location);

    const urlWithoutQuery = window.location.protocol + "//" + window.location.host + window.location.pathname;
    logger.log("Vector starting at " + urlWithoutQuery);

    // Pressgram deep-link: /join/<server>/<token> pretty-URL or ?server=&token= query.
    // Allows admins to share links like:
    //   https://pgram.im/join/news.pgram.im/PREX2026
    //   https://pgram.im/?server=news.pgram.im&token=PREX2026
    // so non-technical users don't have to type server names or paste invite codes.
    // Requires nginx SPA fallback (try_files ... /index.html) for path-based form.
    let serverOverride: string | undefined;
    let regToken: string | undefined;
    const pathMatch = window.location.pathname.match(/^\/join\/([^/]+)(?:\/([^/]+))?\/?$/);
    if (pathMatch) {
        serverOverride = decodeURIComponent(pathMatch[1]);
        if (pathMatch[2]) regToken = decodeURIComponent(pathMatch[2]);
        // Rewrite URL to clean root so reload / share doesn't re-trigger.
        window.history.replaceState(null, "", "/" + window.location.hash);
    } else {
        if (typeof params.server === "string" && params.server.length > 0) serverOverride = params.server;
        if (typeof params.token === "string" && params.token.length > 0) regToken = params.token;
    }

    // Persist server override across OIDC round-trips (MAS cancel/error returns us here
    // without the deep-link params). Cleared only when user explicitly closes the tab or
    // we call sessionStorage.removeItem on successful login.
    try {
        if (serverOverride) {
            sessionStorage.setItem("pressgram_server_override", serverOverride);
        } else {
            const stored = sessionStorage.getItem("pressgram_server_override");
            if (stored) serverOverride = stored;
        }
    } catch {
        // sessionStorage may be unavailable (private mode / quota); deep-link still works one-shot.
    }

    if (regToken) {
        // Cookie readable by MAS on auth.*.pgram.im — picked up by registration_token.html
        // template JS to pre-fill the invite code field.
        const cookieDomain = inferPressgramCookieDomain(window.location.hostname);
        const secure = window.location.protocol === "https:" ? "; Secure" : "";
        document.cookie =
            `pressgram_reg_token=${encodeURIComponent(regToken)}` +
            (cookieDomain ? `; domain=${cookieDomain}` : "") +
            `; path=/; max-age=3600; SameSite=Lax${secure}`;
        logger.log("Pressgram: stored registration token in cookie for MAS pre-fill");
    }

    if (serverOverride && regToken && !window.location.hash) {
        // Magic-link with token → take user straight to registration screen.
        window.location.hash = "#/register";
    }

    if ((serverOverride || regToken) && !pathMatch) {
        // Strip deep-link params from URL so they don't leak on reload / share.
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete("server");
        cleanUrl.searchParams.delete("token");
        window.history.replaceState(null, "", cleanUrl.href);
    }

    platform?.startUpdater();

    // Don't bother loading the app until the config is verified
    const config = await verifyServerConfig(serverOverride);
    const snakedConfig = new SnakedObject<IConfigOptions>(config);

    // Before we continue, let's see if we're supposed to do an SSO redirect
    const [userId] = await Lifecycle.getStoredSessionOwner();
    const hasPossibleToken = !!userId;
    const isReturningFromSso = !!params.loginToken || (!!params.code && !!params.state);
    const ssoRedirects = config.sso_redirect_options || {};
    let autoRedirect = ssoRedirects.immediate === true;
    // XXX: This path matching is a bit brittle, but better to do it early instead of in the app code.
    const isWelcomeOrLanding =
        window.location.hash === "#/welcome" || window.location.hash === "#" || window.location.hash === "";
    const isLoginPage = window.location.hash === "#/login";

    if (!autoRedirect && ssoRedirects.on_welcome_page && isWelcomeOrLanding) {
        autoRedirect = true;
    }
    if (!autoRedirect && ssoRedirects.on_login_page && isLoginPage) {
        autoRedirect = true;
    }

    // getInitialScreenAfterLogin has a side effect to write to sessionStorage, perform it before auto-redirect
    const initialScreenAfterLogin = getInitialScreenAfterLogin(window.location);

    if (!hasPossibleToken && !isReturningFromSso && autoRedirect && config.validated_server_config) {
        const redirecting = await redirectToSso(config.validated_server_config);

        // We return here because startSingleSignOn() will asynchronously redirect us. We don't
        // care to wait for it, and don't want to show any UI while we wait (not even half a welcome
        // page). As such, just don't even bother loading the MatrixChat component.
        if (redirecting) {
            return <React.Fragment />;
        }
    }

    const defaultDeviceName =
        snakedConfig.get("default_device_display_name") ?? platform?.getDefaultDeviceDisplayName();

    const wrapperOpts: WrapperOpts = { Wrapper: React.Fragment };
    ModuleRunner.instance.invoke(WrapperLifecycle.Wrapper, wrapperOpts);

    return (
        <wrapperOpts.Wrapper>
            <StrictMode>
                <MatrixChat
                    ref={matrixChatRef}
                    onNewScreen={onNewScreen}
                    config={config}
                    realQueryParams={params}
                    startingFragmentQueryParams={fragParams}
                    enableGuest={!config.disable_guests}
                    onTokenLoginCompleted={onTokenLoginCompleted}
                    initialScreenAfterLogin={initialScreenAfterLogin}
                    defaultDeviceDisplayName={defaultDeviceName}
                />
            </StrictMode>
        </wrapperOpts.Wrapper>
    );
}

// Pressgram: return the parent cookie domain (e.g. ".pgram.im") so MAS on auth.*.pgram.im
// can read the registration token cookie. Returns undefined for non-matching hosts
// (e.g. localhost or custom deployments) — cookie then falls back to host-only.
function inferPressgramCookieDomain(hostname: string): string | undefined {
    const parts = hostname.split(".");
    if (parts.length < 2) return undefined;
    // Take the registrable domain (last two labels): pgram.im, pgram.io, example.com
    return "." + parts.slice(-2).join(".");
}

async function verifyServerConfig(serverNameOverride?: string): Promise<IConfigOptions> {
    // Pressgram: if deep-link server override fails to resolve (typo, dead server),
    // silently fall back to the default server instead of showing the error page.
    if (serverNameOverride) {
        try {
            return await verifyServerConfigInner(serverNameOverride);
        } catch (e) {
            logger.warn(
                `Pressgram: deep-link server "${serverNameOverride}" failed to validate, ` +
                    `falling back to default server config`,
                e,
            );
        }
    }
    return verifyServerConfigInner(undefined);
}

async function verifyServerConfigInner(serverNameOverride?: string): Promise<IConfigOptions> {
    let validatedConfig: ValidatedServerConfig;
    try {
        logger.log("Verifying homeserver configuration");

        // Note: the query string may include is_url and hs_url - we only respect these in the
        // context of email validation. Because we don't respect them otherwise, we do not need
        // to parse or consider them here.

        // Note: Although we throw all 3 possible configuration options through a .well-known-style
        // verification, we do not care if the servers are online at this point. We do moderately
        // care if they are syntactically correct though, so we shove them through the .well-known
        // validators for that purpose.

        const config = SdkConfig.get();
        let wkConfig = config["default_server_config"]; // overwritten later under some conditions
        let serverName = config["default_server_name"];
        const hsUrl = config["default_hs_url"];
        const isUrl = config["default_is_url"];

        // Pressgram deep-link: if ?server= was passed, discover that server instead of the default.
        if (serverNameOverride) {
            logger.log(`Pressgram: overriding default server with ${serverNameOverride}`);
            serverName = serverNameOverride;
            wkConfig = undefined; // force .well-known lookup for the override
        }

        const incompatibleOptions = [wkConfig, serverName, hsUrl].filter((i) => !!i);
        if (hsUrl && (wkConfig || serverName)) {
            // noinspection ExceptionCaughtLocallyJS
            throw new UserFriendlyError("error|invalid_configuration_mixed_server");
        }
        if (incompatibleOptions.length < 1) {
            // noinspection ExceptionCaughtLocallyJS
            throw new UserFriendlyError("error|invalid_configuration_no_server");
        }

        if (hsUrl) {
            logger.log("Config uses a default_hs_url - constructing a default_server_config using this information");
            logger.warn(
                "DEPRECATED CONFIG OPTION: In the future, default_hs_url will not be accepted. Please use " +
                    "default_server_config instead.",
            );

            wkConfig = {
                "m.homeserver": {
                    base_url: hsUrl,
                },
            };
            if (isUrl) {
                wkConfig["m.identity_server"] = {
                    base_url: isUrl,
                };
            }
        }

        let discoveryResult: ClientConfig | undefined;
        if (!serverName && wkConfig) {
            logger.log("Config uses a default_server_config - validating object");
            discoveryResult = await AutoDiscovery.fromDiscoveryConfig(wkConfig);
        }

        if (serverName) {
            logger.log("Config uses a default_server_name - doing .well-known lookup");
            logger.warn(
                "DEPRECATED CONFIG OPTION: In the future, default_server_name will not be accepted. Please " +
                    "use default_server_config instead.",
            );
            discoveryResult = await AutoDiscovery.findClientConfig(serverName);
            if (discoveryResult["m.homeserver"].base_url === null && wkConfig) {
                logger.log("Finding base_url failed but a default_server_config was found - using it as a fallback");
                discoveryResult = await AutoDiscovery.fromDiscoveryConfig(wkConfig);
            }
        }

        validatedConfig = await AutoDiscoveryUtils.buildValidatedConfigFromDiscovery(serverName, discoveryResult, true);
    } catch (e) {
        const { hsUrl, isUrl, userId } = await Lifecycle.getStoredSessionVars();
        if (hsUrl && userId) {
            logger.error(e);
            logger.warn("A session was found - suppressing config error and using the session's homeserver");

            logger.log("Using pre-existing hsUrl and isUrl: ", { hsUrl, isUrl });
            validatedConfig = await AutoDiscoveryUtils.validateServerConfigWithStaticUrls(hsUrl, isUrl, true);
        } else {
            // the user is not logged in, so scream
            throw e;
        }
    }

    validatedConfig.isDefault = true;

    // Just in case we ever have to debug this
    logger.log("Using homeserver config:", validatedConfig);

    // Add the newly built config to the actual config for use by the app
    logger.log("Updating SdkConfig with validated discovery information");
    SdkConfig.add({ validated_server_config: validatedConfig });

    return SdkConfig.get();
}
