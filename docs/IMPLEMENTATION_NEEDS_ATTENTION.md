# Needs Attention Refactor Implementation Plan

## Overview
We are refactoring the raw "Needs Attention" list currently situated at the bottom of the Overview dashboard. It will be replaced by a clean, globally accessible **Action Queue** combining a "Notification Engine" with an "Airy Avatar" layout.

## Phase 1: Global Notification Trigger
- Implement a floating "Bell" or "Action Queue" pill on the dashboard navigation. 
- The trigger must feel organic to the existing navigation and display a dynamic badge counter when there are unresolved items (Driver or Online orders).
- The raw `needs-attention-wrap` on the Overview tab will be removed completely to instantly clean up the overview tab's vertical density.

## Phase 2: The Queue Slide-Out Sheet
- Architect a new `slide-up-sheet` component named `action-queue-sheet`.
- The sheet will mirror the sleek, consistent glassmorphic/modal styles utilized in the Driver Orders redesign.
- Implement an "Inbox Zero" empty state featuring a beautiful graphic and success message when the queue drops to zero.

## Phase 3: Avatar-based Uniformity
- Rework the HTML injection inside `renderNeedsAttention()` to drop the old row layout. 
- Map `needs-attention-items` into the `order-card-avatar` layout structure we built prior.
- Online orders will gain a shopping cart avatar, while Driver orders pull initials or standard initials layout.
- Fix the existing bug causing an error on `openOrderDetail` clicks for driver orders inside the queue.

## Phase 4: Integration
- Hook up `renderNeedsAttention()` to populate `#action-queue-sheet` instead of the legacy overview container.
- Update global CSS for spacing, typography, and hover mechanisms.
