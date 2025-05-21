# Nostria - Developer Notes

## Self-Contained Components

As much as possible, components should be self-contained and have the ability to look up data on their own.

This is because sometimes we want to use virtual scrolling and not load the data within the component until it is visible.

For example rendering a list of 1000 badges. We will bind to the <app-badge> component and pass the information we have, but the component will look up the badge definition by itself when it's visible/rendered.

## Account Discovery Process

The logic that attempts to discover a user is as follows:

1. Get Relay List from Discovery Relays. Fallback to get Following List from Discovery Relays.
2. Get metadata from User Relays (only 3 of them).

1. Get Relay List from Account Relays. Fallback to get Following List from Account Relays.
2. Get metadata from User Relays (only 3 of them).

If the Relay List/Following List is discovered elsewhere than Discovery Relay, Nostria will publish the Relay List/Following List to the User Relays.

This ensures next user who tries to discover the account will get the Relay List/Following List from the Discovery Relays, and not from the User Relays.
