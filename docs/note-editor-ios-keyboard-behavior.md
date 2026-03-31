# Note Editor iOS Keyboard Behavior

This document records the iPhone Safari handling for `NoteEditorDialogComponent` and `CustomDialogComponent`.

## Why This Exists

On iPhone Safari, focusing a lower caret inside a long textarea can cause the browser to pan the visual viewport independently of the layout viewport. If the dialog remains fixed to the layout viewport, or if outer dialog wrappers remain scrollable, the whole composer can appear to jump upward, disappear partially above the top edge, or fall behind the on-screen keyboard.

The current implementation deliberately works around that behavior.

## Required Invariants

These rules should not be removed or simplified without validating on a physical iPhone Safari device with a long note and the software keyboard open.

1. `CustomDialogComponent` must follow iOS `visualViewport` pan and resize changes so full-screen dialogs stay aligned with the visible viewport.
2. In compact keyboard mode, the note editor textarea is the only scrollable area for caret reveal. Outer wrappers must not become the active vertical scroll target.
3. Compact footer positioning must be based on actual visible-viewport overlap, not on caret depth or inferred viewport panning.
4. Compact textarea sizing must use visible viewport geometry and the measured footer position in the same coordinate space.
5. Focusing deeper in a long note must only change textarea scroll, not move the entire dialog higher than the visible top of the page.

## Current Implementation Points

- `src/app/components/custom-dialog/custom-dialog.component.ts`
  - Tracks iOS `visualViewport` resize and scroll.
  - Applies host translation so the fixed dialog stays aligned with the visible viewport.
  - Maintains iOS body scroll lock and touch-scroll guarding.

- `src/app/components/note-editor-dialog/note-editor-dialog.component.ts`
  - Enters compact keyboard mode only when iOS viewport height shrinks enough while the textarea is focused.
  - Sizes `content-field` and the textarea from visible viewport geometry.
  - Keeps the outer dialog wrapper pinned while the textarea handles caret reveal.
  - Uses delayed refresh on iOS focus/viewport changes to avoid intermediate Safari keyboard states.

- `src/app/components/note-editor-dialog/note-editor-dialog.component.scss`
  - Forces compact-mode wrappers to stop acting like outer scroll containers.
  - Keeps the bordered textarea container and textarea on the same compact height.

## Validation Checklist

Validate on a physical iPhone Safari device, not only desktop emulation.

1. Open `New Note` with a long existing note body.
2. Focus near the top of the textarea.
3. Focus near the middle of the textarea.
4. Focus near the bottom of the textarea.
5. Repeat the same focus position multiple times.

Expected behavior:

- The full-screen dialog remains aligned with the visible top edge.
- The action bar stays visible above the keyboard.
- The yellow textarea border matches the visible textarea area.
- Only the textarea scroll changes to reveal the caret.
- Repeating the same focus position does not produce different vertical dialog positions.

## Refactoring Guidance

- Do not reintroduce outer wrapper scrolling in compact keyboard mode unless the iPhone Safari focus cases above are revalidated.
- Do not derive footer movement from caret depth or `visualViewport.offsetTop` alone.
- If the implementation changes, update this document and the architecture notes together.
