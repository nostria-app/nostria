# NIP-05 Auto-Set on Username Change

## Summary

Implemented automatic NIP-05 identifier setting when users set or change their Premium username. The system now intelligently handles existing NIP-05 values and allows users to decide whether to update them.

## Implementation Details

### Changes Made

#### 1. Set Username Dialog Component (`set-username-dialog.component.ts`)

**Added Imports:**
- `MatCheckboxModule` - For the NIP-05 update checkbox
- `Profile` service - To handle profile updates

**New State Management:**
- `existingNip05` signal - Tracks the user's current NIP-05 value
- `shouldUpdateNip05` property - User's choice to update existing NIP-05
- `hasExistingNip05()` computed signal - Determines if user has an existing NIP-05

**Constructor Changes:**
- Retrieves current profile's NIP-05 value on component initialization
- Defaults `shouldUpdateNip05` to `true` if user already has a NIP-05

**Enhanced Save Logic:**
After successfully setting the username:
1. Checks if profile update is needed (no existing NIP-05 OR user chose to update)
2. Creates/updates profile with new NIP-05: `username@nostria.app`
3. Uses `skipMediaServerCheck: true` to avoid requiring media servers for NIP-05 update
4. Shows appropriate success/error messages
5. Handles partial failures gracefully (username set but NIP-05 update failed)

### UI/UX Changes

**Template Additions:**
Added a new NIP-05 section that displays after username validation:

**Case 1: No Existing NIP-05**
- Shows an auto-set notification with verified icon
- Informs user their NIP-05 will be automatically set to `username@nostria.app`

**Case 2: Existing NIP-05**
- Displays current NIP-05 value in an info box
- Provides a checkbox asking if user wants to update to `username@nostria.app`
- Defaults to checked for easier user experience

**Styling:**
Added CSS for:
- `.nip05-section` - Container for NIP-05 information
- `.existing-nip05` - Display box for current NIP-05
- `.nip05-label` / `.nip05-value` - Typography for NIP-05 display
- `.nip05-auto-set` - Auto-set notification styling

## Behavior

### Scenario 1: User has no NIP-05
1. User enters and validates a username
2. UI shows: "Your NIP-05 identifier will be automatically set to username@nostria.app"
3. On save:
   - Username is set via API
   - Profile is updated with NIP-05 value
   - Success message shown

### Scenario 2: User has existing NIP-05
1. User enters and validates a username
2. UI shows:
   - Current NIP-05 value
   - Checkbox (checked by default): "Update NIP-05 to username@nostria.app"
3. On save:
   - Username is set via API
   - If checkbox is checked: Profile updated with new NIP-05
   - If checkbox is unchecked: Profile keeps existing NIP-05
   - Success message shown

### Error Handling

- If username update succeeds but profile update fails:
  - Shows warning message: "Username set successfully, but failed to update NIP-05: [error]"
  - Dialog still closes with success status
  - User can manually update NIP-05 later in profile settings

- If username update fails:
  - Shows error message
  - Dialog remains open
  - No profile changes attempted

## Technical Notes

### Why `skipMediaServerCheck: true`?

The profile update uses `skipMediaServerCheck: true` because:
1. We're only updating the NIP-05 text field
2. No image uploads are involved
3. Prevents unnecessary validation that would block NIP-05 updates

### Profile Service Integration

The implementation leverages the existing `Profile.updateProfile()` method with:
- Existing profile data preservation
- NIP-05 field update
- Automatic relay publishing
- Local storage updates
- Account state synchronization

## Future Enhancements

Potential improvements:
1. Add NIP-05 verification status indicator
2. Show if NIP-05 is already verified
3. Add "verify now" button after setting NIP-05
4. Allow custom NIP-05 domains for Premium users
