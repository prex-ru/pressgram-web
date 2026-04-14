/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React from "react";
import { render, screen } from "@test-utils";
import { composeStories } from "@storybook/react-vite";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";

import * as stories from "./RoomListToast.stories";
import { RoomListToast } from "./RoomListToast";

const { SectionCreated } = composeStories(stories);

describe("<RoomListToast />", () => {
    it("renders SectionCreated story", () => {
        const { container } = render(<SectionCreated />);
        expect(container).toMatchSnapshot();
    });

    it("calls onClose when the close button is clicked", async () => {
        const user = userEvent.setup();

        const onCloseMock = vi.fn();
        render(<RoomListToast type="section_created" onClose={onCloseMock} />);
        const closeButton = screen.getByRole("button", { name: "Close" });
        await user.click(closeButton);
        expect(onCloseMock).toHaveBeenCalled();
    });
});
