# Nostria - Developer Notes

## Self-Contained Components

As much as possible, components should be self-contained and have the ability to look up data on their own.

This is because sometimes we want to use virtual scrolling and not load the data within the component until it is visible.

For example rendering a list of 1000 badges. We will bind to the <app-badge> component and pass the information we have, but the component will look up the badge definition by itself when it's visible/rendered.

