# Zap Split Feature - UI Mockup

## Visual Description

### Location
The zap split feature appears in the **Advanced Options** section of the Note Editor Dialog, but **only when quoting a note and the user is logged in**.

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│ Note Editor Dialog                                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  📝 Quote context:                                          │
│  💬 Quoting: "Original note content here..."                │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ What's on your mind?                                │  │
│  │ [Text editor area for quote commentary]            │  │
│  │                                                     │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ 👁️ Preview  🤖 AI  🎤 Mic  🖼️ Image  ⚙️ Advanced Options   │
└─────────────────────────────────────────────────────────────┘
```

### When Advanced Options is Clicked

```
┌─────────────────────────────────────────────────────────────┐
│ ⚙️ Advanced Options                                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ 🔄 Upload Original                                          │
│   Skip transcoding and optimization when uploading media   │
│                                                             │
│ 🏷️ Add Client Tag                                           │
│   Add the Nostria client tag to this event                 │
│                                                             │
│ ⏰ Expiration                                                │
│   Set an expiration date and time for this note            │
│                                                             │
│ ⚡ Proof of Work (Difficulty: 0)                            │
│   Add computational proof to deter spam (NIP-13)           │
│   [Slider: 0 ────────●─────────────────────── 26]          │
│                                                             │
│ ⚡💰 Enable Zap Split                         [Toggle: ON]  │
│   Split zaps between the original author and yourself      │
│   when people zap your quote                               │
│                                                             │
│   ┌───────────────────────────────────────────────────┐   │
│   │ Original Author                            90%    │   │
│   │ [Slider: 0 ────────────────────────●────── 100]  │   │
│   │                                                   │   │
│   │ You (Quoter)                               10%    │   │
│   │ [Slider: 0 ──●──────────────────────────── 100]  │   │
│   │                                                   │   │
│   │ ℹ️ When someone zaps your quote, the zap will be │   │
│   │   automatically split according to these          │   │
│   │   percentages (NIP-57).                           │   │
│   └───────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Visual Design Elements

### Toggle Switch
- **State**: ON (purple/primary color) or OFF (gray)
- **Label**: "Enable Zap Split"
- **Style**: Angular Material slide-toggle component

### Sliders
- **Type**: Discrete sliders with tick marks
- **Range**: 0 to 100
- **Step**: 1
- **Style**: Angular Material slider component
- **Color**: Primary theme color when active

### Percentage Display
- **Format**: "90%" in purple/primary color
- **Position**: Right-aligned next to each slider label
- **Updates**: Real-time as slider moves

### Hint Text
- **Style**: Small, gray text below sliders
- **Icon**: ℹ️ information icon
- **Content**: Explains NIP-57 automatic splitting

## Interaction Flow

### 1. User Quotes a Note
```
[Repost Button Menu]
  ├─ Repost ←─ standard repost
  └─ Quote  ←─ USER CLICKS THIS
       ↓
  [Note Editor Opens]
       ↓
  [Quote context shown]
       ↓
  [User can optionally click "Advanced Options"]
       ↓
  [Zap Split option appears]
```

### 2. User Adjusts Split
```
[User enables toggle]
  ↓
[Sliders appear]
  ↓
[User drags "Original Author" slider to 80%]
  ↓
[Quoter slider auto-updates to 20%]
  ↓
[Percentages shown: 80% / 20%]
```

### 3. User Publishes Quote
```
[User clicks "Publish" button]
  ↓
[Event created with tags:]
  ["q", "quote_id", "", "author_pubkey"]
  ["zap", "author_pubkey", "", "80"]
  ["zap", "quoter_pubkey", "", "20"]
  ↓
[Published to Nostr network]
```

## Color Scheme (Material 3)

### Light Mode
- Primary: Purple (#5953a9)
- Background: White (#ffffff)
- Surface: Light gray (#f5f5f5)
- Text: Dark gray (#1c1b1f)
- Hint: Medium gray (#79747e)

### Dark Mode
- Primary: Light purple (#c5c0ff)
- Background: Very dark purple (#18111b)
- Surface: Dark gray (#241d27)
- Text: Off-white (#ecdeed)
- Hint: Medium gray (#cac4d0)

## Responsive Behavior

### Desktop (>600px)
- Sliders display in two rows
- Full width sliders
- Plenty of padding and spacing

### Mobile (<600px)
- Sliders stack vertically
- Touch-friendly slider thumbs
- Compressed spacing but still readable

## Accessibility

- **Keyboard Navigation**: Tab through toggle and sliders
- **Screen Readers**: Proper ARIA labels on all inputs
- **High Contrast**: Works in high contrast modes
- **Focus Indicators**: Visible focus states on all interactive elements

## States

### 1. Hidden State
- Not quoting → Feature not shown
- Not logged in → Feature not shown

### 2. Disabled State (Toggle OFF)
- Toggle is off
- Sliders are hidden
- Hint text is hidden

### 3. Active State (Toggle ON)
- Toggle is on (purple)
- Both sliders visible
- Percentages displayed
- Hint text visible

### 4. Adjusting State
- User dragging slider
- Real-time percentage updates
- Complementary slider auto-adjusts
- Smooth animations
