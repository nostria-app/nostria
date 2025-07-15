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


# Flow of Article Loading

1. First determine if we only have event id, or if we also have pubkey.
2. If there is only event ID, we must retrieve article from account relays.
3. If there is pubkey, we should first attempt to retrieve article from user relays.
4. Create User Relay Service... 

- should we keep it alive from previous page (if user just looked at their profile and clicked an article).
- if this is a reload, we obviously need to re-create.
- we must perform discovery relay lookup, get relay list, then connect and get article.
- when the "profile" component renders in the article, it should reuse the User Relay Service instance.

... threads, reactions, comments, should all come from the same User Relay Service...

What if we are looking at our own article? The Account Relay Service, should inherit the User Relay Service with additional functionality.

Cache the User Relay Service... for how long? As long as the page is being looked at? When navigate away, drop subscriptions? But not all... let's keep important subscriptions running, such as Profile.

Articles should not be cached, not be saved.
Profile should be cached, should be saved.
Relay List should be cached, should be saved.

Looking at a user profile... creates an User Relay Service instance... clicking on one of their notes, we shouldn't recreate.

But if I go from Profile A, to Profile B, how long should we cache "Profile A User Relay Service"? Should there always only be a single User Relay Service? Maybe that's the better way to manage it, single instance, just change it when a new profile is opened?

... when listing a thread, user profiles must be loaded... currently a new User Relay Service instance is created pr. user. This should be changed into an "Shared Relay Instance" of SimplePool, which takes Relay URLs for each get/subscription, and can manage internally the connections better than we can do.
