# QR Code Scanner Debugging Enhancement

## Overview

Added comprehensive debugging output to the QR code scan dialog to help diagnose scanning issues and provide real-time feedback about what the camera is seeing.

## Debug Features Added

### 1. Real-time Debug Panel
- **Location**: Top-left corner of the camera view
- **Content**: Live status updates and scanning statistics
- **Styling**: Semi-transparent overlay with monospace font for technical readability

### 2. Debug Information Signals
- `debugInfo`: Current status message with emoji indicators
- `framesScanned`: Counter of processed video frames
- `lastScanAttempt`: Timestamp of last scan attempt
- `scanningActive`: Boolean indicating if scanning is active
- `timeSinceLastScan`: Computed property showing seconds since last scan

### 3. Enhanced Status Messages

#### Camera Initialization Phase
- 📹 "Initializing camera..."
- 🎨 "Setting up QR canvas..."
- 📷 "Connecting to camera..."
- 🔍 "Detecting available cameras..."
- 📱 "Setting camera: [Camera Name]"
- ✅ "Camera ready, starting scan..."

#### Scanning Phase
- 🔍 "Starting QR code scanning..."
- 🔍 "Scanning... X frames processed, no QR code detected yet" (every 30 frames)
- ✅ "QR code detected after X frames!"
- 🔄 "Processed: [result preview]"

#### Error States
- ❌ "Cannot start scanning: camera or canvas not available"
- ❌ "Frame loop stopped: camera or canvas unavailable"
- ❌ "Camera initialization failed: [error details]"
- 🚫 "Camera permission denied - check browser settings"
- 📷 "No camera devices found"
- 🚫 "Camera API not supported in this browser"
- 🔒 "Camera in use by another application"
- ⚠️ "Scanner may be stalled. Frames: X, Last scan: Xs ago"

### 4. Scanning Statistics Display
- **Frame Counter**: Shows how many video frames have been processed
- **Time Since Last Scan**: Real-time countdown showing seconds since last scan attempt
- **Stall Detection**: Warns if scanner appears to have stopped processing frames

### 5. Enhanced Error Logging
- Detailed console logging for each initialization step
- Specific error categorization and user-friendly messages
- Debug information preserved even when errors occur

## Debug Panel UI

### Visual Indicators
- 🔍 Scanning in progress
- ✅ Success states
- ❌ Error states
- 📊 Statistics
- 🕒 Timing information
- ⚠️ Warning states

### Layout
```
┌─ Debug Panel ─────────────────┐
│ 🔍 Scanning... 1,234 frames   │
│ processed, no QR code yet     │
│                               │
│ 📊 Frames: 1,234             │
│ 🕒 Last: 2.5s ago            │
└───────────────────────────────┘
```

## Technical Implementation

### New Component Properties
```typescript
// Debug signals
debugInfo = signal<string>('');
framesScanned = signal<number>(0);
lastScanAttempt = signal<Date | null>(null);
scanningActive = signal<boolean>(false);

// Computed property for time calculation
timeSinceLastScan = computed(() => {
  const lastScan = this.lastScanAttempt();
  return lastScan ? (Date.now() - lastScan.getTime()) / 1000 : 0;
});
```

### Debug Interval Management
- Automatic stall detection checks every 2 seconds
- Warns if no scan attempts for over 5 seconds
- Proper cleanup on component destruction

### Enhanced Scanning Loop
```typescript
// Frame processing with debug output
const frameCount = this.framesScanned() + 1;
this.framesScanned.set(frameCount);
this.lastScanAttempt.set(new Date());

// Update debug info every 30 frames
if (frameCount % 30 === 0) {
  this.debugInfo.set(`🔍 Scanning... ${frameCount} frames processed, no QR code detected yet`);
}
```

## Troubleshooting Guide

### Common Issues and Debug Indicators

1. **Camera Permission Issues**
   - Debug shows: "🚫 Camera permission denied"
   - Solution: Check browser permissions

2. **Camera In Use**
   - Debug shows: "🔒 Camera in use by another application"
   - Solution: Close other apps using camera

3. **No QR Code Detection**
   - Debug shows: Frame count increasing but no detection
   - Frame counter helps identify if scanning is active
   - Time counter shows scanner responsiveness

4. **Scanner Stalled**
   - Debug shows: "⚠️ Scanner may be stalled"
   - Indicates frames stopped processing
   - May need camera restart

5. **Initialization Failures**
   - Debug shows specific step where failure occurred
   - Helps identify camera vs. canvas vs. QR library issues

## Benefits

### For Developers
- **Real-time Diagnostics**: See exactly what's happening during scan attempts
- **Performance Monitoring**: Track frame processing rate and timing
- **Error Identification**: Quickly identify root cause of scanning issues
- **State Visibility**: Clear indication of scanner state and activity

### For Users
- **Visual Feedback**: Know if scanner is working or stuck
- **Progress Indication**: See scanning activity and frame counts
- **Error Clarity**: Specific error messages instead of generic failures
- **Troubleshooting**: Clear indicators for common permission/hardware issues

### For QA Testing
- **Reproducible Issues**: Debug info helps recreate and analyze problems
- **Performance Testing**: Frame rate and timing data for optimization
- **Cross-browser Testing**: Identify browser-specific scanning issues
- **Hardware Testing**: Different camera configurations and capabilities

## CSS Styling

The debug panel is styled to be:
- **Non-intrusive**: Semi-transparent overlay that doesn't block camera view
- **Readable**: Monospace font with good contrast for technical information
- **Responsive**: Adapts to mobile screens with smaller text
- **Theme-aware**: Different styling for light/dark themes

The debug information provides comprehensive insight into the QR scanning process, making it much easier to diagnose issues and understand scanner behavior!