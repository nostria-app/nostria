# Real-Time Report Updates

## Overview

Implemented a reactive system that automatically updates the display of reported content when new reports are published, without requiring a page reload.

## Problem

Previously, when a user reported an event (e.g., for "Spam"), the warning indicator would not appear on already-loaded event components. Users had to reload the page to see the updated report status.

## Solution

Created a signal-based notification system that allows components to reactively update when new reports are published.

### Architecture

1. **ReportingService** - Central hub for report notifications
   - Added `reportPublished` signal to track newly published reports
   - Provides `getReportPublishedSignal()` for read-only access
   - Provides `notifyReportPublished(eventId)` to broadcast report events

2. **ReportDialogComponent** - Publishes report notifications
   - After successfully publishing a report to at least one relay
   - Calls `reportingService.notifyReportPublished(eventId)`
   - Only notifies if the report is for content (has eventId)

3. **EventComponent** - Reacts to report notifications
   - Added effect watching `reportPublished` signal
   - Reloads reports when notification matches current event
   - Uses cache invalidation to fetch fresh data

4. **ReportedContentComponent** - Reacts to report notifications
   - Added effect watching `reportPublished` signal
   - Reloads reports when notification matches current event
   - Updates the warning display in real-time

## Implementation Details

### Signal Flow

```
User reports event
    ↓
ReportDialogComponent.submitReport()
    ↓ (on success)
reportingService.notifyReportPublished(eventId)
    ↓ (signal update)
reportPublished signal changes
    ↓ (reactive effects)
EventComponent effect triggers → loadReports(true)
ReportedContentComponent effect triggers → loadReports()
    ↓
UI updates with new report data
```

### Key Features

- **Reactive**: Uses Angular signals for automatic updates
- **Targeted**: Only reloads reports for the specific event that was reported
- **Efficient**: Cache invalidation ensures fresh data without unnecessary queries
- **Real-time**: Warning indicators appear immediately after report is published
- **Reliable**: Only notifies when at least one relay confirms publication

## Files Modified

1. `src/app/services/reporting.service.ts`
   - Added `reportPublished` signal
   - Added `getReportPublishedSignal()` method
   - Added `notifyReportPublished(eventId)` method

2. `src/app/components/report-dialog/report-dialog.component.ts`
   - Modified `submitReport()` to track publish success
   - Added notification call after successful publish

3. `src/app/components/event/event.component.ts`
   - Added effect to watch for report notifications
   - Triggers report reload with cache invalidation

4. `src/app/components/reported-content/reported-content.component.ts`
   - Added effect to watch for report notifications
   - Triggers report reload to update display

## Usage

No changes required to use this feature. The system works automatically:

1. User reports an event via the event menu
2. Report is published to relays
3. All visible instances of the reported event automatically update
4. Report warning appears without page reload

### Testing the Feature

To verify this feature works:

1. Open the application with a timeline showing multiple posts
2. Right-click on a post and select "Report Content"
3. Choose a report type (e.g., "Spam")
4. Submit the report
5. **Observe**: The reported post should immediately show a warning banner without refreshing
6. **Verify**: The warning displays the report type you selected
7. **Check**: If the same post appears elsewhere on the page, it should also show the warning

Expected behavior:
- Report warning appears within 1-2 seconds of successful publish
- Console logs show: `🚨 [Report Notification] New report detected for event: [eventId]`
- The warning replaces the post content (respecting user privacy settings)
- Users can click "Show Anyway" to override the warning

## Benefits

- **Better UX**: Immediate visual feedback when content is reported
- **Consistency**: All instances of an event show the same report status
- **Efficiency**: No need to reload the entire page
- **Scalability**: Works for any number of event components on the page

## Future Enhancements

Potential improvements:
- Subscribe to relay events for reports from other users
- Show notification toast when report is published
- Add animation/transition for report warning appearance
- Track report publication progress per relay
