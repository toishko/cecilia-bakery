# Needs Attention Refactor Implementation Plan

## Overview
We are refactoring the raw "Needs Attention" list currently situated at the bottom of the Overview dashboard. It will be replaced by a clean, globally accessible **Action Queue** combining a "Notification Engine" with an "Airy Avatar" layout.

## Phase 1: Global Notification Trigger ✅
- [x] Implement a floating "Bell" or "Action Queue" pill on the dashboard navigation. 
- [x] The trigger must feel organic to the existing navigation and display a dynamic badge counter when there are unresolved items (Driver or Online orders).
- [x] The raw `needs-attention-wrap` on the Overview tab will be removed completely to instantly clean up the overview tab's vertical density.

## Phase 2: The Queue Slide-Out Sheet ✅
- [x] Architect a new `slide-up-sheet` component named `action-queue-sheet`.
- [x] The sheet will mirror the sleek, consistent glassmorphic/modal styles utilized in the Driver Orders redesign.
- [x] Implement an "Inbox Zero" empty state featuring a beautiful graphic and success message when the queue drops to zero.

## Phase 3: Avatar-based Uniformity ✅
- [x] Rework the HTML injection inside `renderNeedsAttention()` to drop the old row layout. 
- [x] Map `needs-attention-items` into the `order-card-avatar` layout structure we built prior.
- [x] Online orders will gain a shopping cart avatar, while Driver orders pull initials or standard initials layout.
- [x] Fix the existing bug causing an error on `openOrderDetail` clicks for driver orders inside the queue.

## Phase 4: Integration ✅
- [x] Hook up `renderNeedsAttention()` to populate `#action-queue-sheet` instead of the legacy overview container.
- [x] Update global CSS for spacing, typography, and hover mechanisms.

## Phase 5: FAB & Sheet Polish ✅
- [x] FAB tap toggle — tap to open, tap again to close
- [x] Fix mobile FAB double-fire (touchend + click both triggered openQueueSheet)
- [x] Draggable FAB — drag to reposition, snap to nearest edge
- [x] Swipe-to-dismiss on queue sheet (drag handle down to close)
- [x] Body scroll lock without bottom nav tab jump (class-based `html.scroll-locked`)
- [x] Swipe-to-dismiss also added to Pending Collection and Total Ordered sheets

## Notes & Decisions
- 2026-04-19: Replaced all inline `position:fixed + top:-Npx` body scroll locks with `html.scroll-locked` CSS class to eliminate bottom nav visual jump
- 2026-04-19: FAB idle opacity fades to 0.4 after 3s, wakes on touch/hover
- 2026-04-19: `handledByTouch` flag blocks click event for 400ms after touch to prevent double-fire

