# Nostria Invitation System

## Overview

A complete invitation system has been implemented to allow Nostria users to invite their friends to join the platform. When someone accepts an invite, they automatically follow the person who invited them, creating an instant connection on the Nostr network.

## Features

### 1. Invite Link Generation

Users can generate personalized invite links that include:
- Their public key (pubkey)
- Their relay list (up to 5 relays)
- Encoded as an nprofile for compatibility

### 2. Welcome Experience

When someone opens an invite link (`/invite/:nprofile`), they see:
- The Nostria logo and branding
- Information about who invited them (with avatar)
- Key benefits of Nostria:
  - **You Own Your Identity**: Account can never be deleted or banned
  - **Control Your Feed**: No algorithm decides what you see
  - **Support Creators with Zaps**: Send Bitcoin tips instantly
- Call-to-action buttons to join or login

### 3. Auto-Follow Functionality

When a new user accepts an invite:
1. They're guided through the account creation process
2. After successfully creating their account
3. They automatically follow the person who invited them
4. They're redirected to the home feed

Existing users who click an invite link can:
- Login with their existing account
- Navigate to the inviter's profile

## Implementation Details

### Files Created

1. **`src/app/pages/invite/invite.component.ts`**
   - Handles invite link decoding
   - Loads inviter profile information
   - Manages login flow and auto-follow logic

2. **`src/app/pages/invite/invite.component.html`**
   - Attractive welcome page with feature highlights
   - Displays inviter information
   - Action buttons for joining or logging in

3. **`src/app/pages/invite/invite.component.scss`**
   - Responsive design that works on all devices
   - Gradient background for visual appeal
   - Card-based feature presentation

### Files Modified

1. **`src/app/app.routes.ts`**
   - Added route: `/invite/:nprofile`
   - Handles nprofile parameter containing inviter information

2. **`src/app/pages/profile/profile-header/profile-header.component.ts`**
   - Added `shareInviteLink()` method - generates and shares invite link
   - Added `copyInviteLink()` method - copies invite link to clipboard
   - Uses nprofile encoding to include pubkey and relays

3. **`src/app/pages/profile/profile-header/profile-header.component.html`**
   - Added "Invite to Nostria" option in Share menu
   - Added "Invite Link" option in Copy menu
   - Both prominently placed at the top of their respective menus

## How to Use

### As an Inviter

1. Navigate to your profile page
2. Click the menu button (three dots)
3. Choose either:
   - **Share → Invite to Nostria**: Opens native share dialog (mobile) or copies link
   - **Copy → Invite Link**: Copies the invite link to clipboard
4. Share the link via any messaging platform

### As an Invitee

1. Click on the invite link received
2. See personalized welcome page with inviter's information
3. Choose an action:
   - **Create Account & Follow [Name]**: New users create account and auto-follow
   - **I Already Have an Account**: Existing users login normally
   - **Skip for now**: Navigate to home without action

## Technical Implementation

### Invite URL Format

```
https://nostria.app/invite/nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8gpp4mhxue69uhhytnc9e3k7mgpz4mhxue69uhkg6nzv9ejuumpv34kytnrdaksjlyr9p
```

The nprofile contains:
- User's public key (hex encoded)
- User's relay URLs (for connectivity)

### Auto-Follow Flow

1. Inviter pubkey is stored in `sessionStorage` with key `nostria_invite_follow`
2. Login dialog opens with new user flow
3. After dialog closes and account is created:
   - The system waits 500ms for account state to stabilize
   - Retrieves the stored pubkey
   - Calls `accountState.follow(pubkey)`
   - Clears the session storage
   - **Navigates to the inviter's profile page** (not home)
4. User can immediately see the person who invited them and start exploring their content

### Error Handling

- Invalid invite links show a friendly error message
- Failed profile loads still allow proceeding with invite
- Follow failures don't prevent navigation to home
- Graceful fallbacks for missing data

## User Experience Benefits

1. **Seamless Onboarding**: New users immediately have someone to follow
2. **Social Discovery**: Invites create natural network effects
3. **Trust Signal**: Being invited by someone adds legitimacy
4. **Easy Sharing**: One-click sharing across all platforms
5. **Mobile-Friendly**: Uses native share sheet on mobile devices

## Future Enhancements

Possible improvements for the future:

1. **Invite Analytics**: Track how many people used your invite
2. **Referral Rewards**: Gamification for inviting users
3. **Group Invites**: Generate links that follow multiple people
4. **Expiring Links**: Optional time-limited invites
5. **Custom Messages**: Add personalized message to invite
6. **QR Codes**: Generate QR codes for in-person invites

## Testing

To test the invitation system:

1. **Generate Invite Link**:
   - Go to any profile
   - Use the Share or Copy menu to get invite link

2. **Test Welcome Page**:
   - Open invite link in new browser/incognito
   - Verify inviter information displays correctly
   - Check that all features are listed

3. **Test Auto-Follow**:
   - Create a new account via invite link
   - After login, verify you're following the inviter
   - Check that you're redirected to home feed

4. **Test Existing Account**:
   - Use invite link with existing account
   - Verify login flow works
   - Check navigation to inviter's profile

## Related Files

- `src/app/services/account-state.service.ts` - Follow/unfollow logic
- `src/app/services/layout.service.ts` - Login dialog management
- `src/app/components/login-dialog/login-dialog.component.ts` - Account creation flow
