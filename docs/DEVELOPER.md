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


### Fallbacks

There are accounts that do not have a Relay List or Following List, in which case we will try to get the metadata from the Account Relays.


## Services

- Account Service (Singleton): Interacts with the Nostria API.
- Account State Service (Singleton): Handles the state of the current account.
- Profile State Service (Singleton): Handles the state of the current profile that the user is viewing.
- Data Service (Singleton): Handles the data fetching and caching for the application. Currently only uses database storage. Wraps events as Records.
- Nostr Service (Singleton): Handles the Nostr protocol interactions, such as sending and receiving events.
- User Relay Factory (Singleton): Handles the creation and management of user relays.
- User Relay Service (Instance): Handles the interactions with user relays, such as fetching metadata and relay lists.
- Account Relay Service (Singleton): Handles the interactions with account relays, such as fetching events.
- Discovery Relay Service (not implemented): Handles the interactions with discovery relays, such as fetching relay lists and following lists.
- Application Service: Holds initialized signal (combination of storage and nostr initialization).
- Application State Service: Handles some of the state of the application.
