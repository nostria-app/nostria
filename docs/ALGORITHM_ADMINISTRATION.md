# Algorithm Administration UI Guide

## Overview

The Algorithm Administration UI provides comprehensive tools for managing and analyzing user engagement metrics in the Nostria application. This interface allows you to:

- Monitor algorithm performance and statistics
- View and manage user engagement metrics
- Add/remove users from favorites
- Reset metrics for individual users or all users
- Analyze user interaction patterns

## Features

### 🎯 **Algorithm Statistics Dashboard**

The main dashboard displays key metrics:

- **Total Users**: Number of users with metrics
- **Favorites**: Number of users marked as favorites
- **Active Users**: Users who interacted in the last 7 days
- **Average Engagement**: Average engagement score across all users

### 📊 **User Metrics Tabs**

#### 1. **Top Engaged Users**

- Shows users with highest engagement scores
- Displays metrics like views, likes, time spent
- Favorites are highlighted with a star icon
- Sortable table format with actions menu

#### 2. **Recently Viewed**

- Users you've recently interacted with
- Shows last interaction timestamp
- Card-based layout with key metrics
- Quick favorite/unfavorite buttons

#### 3. **Declining Engagement**

- Users with good engagement but no recent activity
- Potential re-engagement opportunities
- Shows engagement score and last interaction
- Helps identify users to reconnect with

#### 4. **Favorites**

- All users marked as favorites
- These users always appear at the top of recommendations
- Easy management interface to add/remove favorites

### ⭐ **Favorites System**

The favorites system ensures preferred users always rank at the top:

#### In Profile Header Menu:

- **Add to Favorites**: Star icon (⭐) in profile menu
- **Remove from Favorites**: Filled star icon in profile menu
- Visual feedback with snackbar notifications

#### In Algorithm Settings:

- Dedicated favorites tab
- Bulk management capabilities
- Visual indicators throughout the interface

### 🔄 **Metrics Management**

#### Individual User Actions:

- **Reset Metrics**: Clear all metrics for a specific user
- **Toggle Favorite**: Add/remove from favorites list
- **View Details**: See comprehensive metric breakdown

#### Bulk Actions:

- **Reset All Metrics**: Clear all user metrics (with confirmation)
- **Refresh Data**: Reload all metrics and recalculate scores

### 📈 **Engagement Score Calculation**

The engagement score is calculated using weighted values:

```typescript
Engagement Score =
  (viewed × 1) +
  (profileClicks × 2) +
  (liked × 3) +
  (read × 4) +
  (replied × 5) +
  (reposted × 4) +
  (quoted × 6) +
  (messaged × 8) +
  (mentioned × 4) +
  (timeSpent × 0.001)
```

### 🎨 **Visual Indicators**

- **Color-coded chips**: Engagement scores have different colors
  - High engagement (100+): Primary color
  - Medium engagement (50-99): Accent color
  - Low engagement (20-49): Warning color
  - Very low engagement (<20): No color

- **Star icons**: Favorites are marked with star icons
- **Time formatting**: Human-readable time displays (e.g., "2h ago", "5m")

## Usage Instructions

### 1. **Accessing Algorithm Settings**

1. Navigate to Settings (⚙️)
2. Click on "Algorithm" in the sidebar
3. View the dashboard and metrics

### 2. **Managing Favorites**

#### From Profile:

1. Visit any user's profile
2. Click the menu button (⋮) in the profile header
3. Select "Add to Favorites" or "Remove from Favorites"

#### From Algorithm Settings:

1. Go to the "Favorites" tab
2. View all current favorites
3. Remove favorites using the "Remove" button

### 3. **Analyzing User Engagement**

1. **Top Engaged**: See who you interact with most
2. **Recently Viewed**: Check recent interactions
3. **Declining Engagement**: Find users to re-engage with
4. **Use filters**: Sort by different metrics

### 4. **Resetting Metrics**

#### Individual User:

1. Find the user in any metrics table
2. Click the menu button (⋮) in the Actions column
3. Select "Reset Metrics"
4. Confirm the action

#### All Users:

1. Click "Reset All Metrics" in the Actions card
2. Confirm the destructive action

### 5. **Understanding the Data**

- **Views**: How many times you've seen their profile
- **Likes**: Posts you've liked from this user
- **Time Spent**: Total time viewing their content
- **Engagement Score**: Weighted calculation of all interactions
- **Last Interaction**: When you last interacted with them

## Advanced Features

### 🤖 **Algorithm Integration**

The favorites system integrates directly with the recommendation algorithm:

```typescript
// Favorites always appear first in recommendations
const recommendations = await algorithms.calculateProfileViewed(20, false);
// Results: [favorites sorted by engagement, then regular users]
```

### 📱 **Mobile Responsive**

The interface is fully responsive:

- Mobile-optimized tables
- Touch-friendly interactions
- Adapted layouts for smaller screens

### 💾 **Data Persistence**

- **Metrics**: Stored in IndexedDB
- **Favorites**: Stored in localStorage
- **Real-time updates**: Changes reflect immediately
- **Backup friendly**: Can be exported/imported

## Best Practices

1. **Regular Review**: Check algorithm performance weekly
2. **Favorite Management**: Keep favorites list current and relevant
3. **Metric Cleanup**: Reset metrics for users you no longer engage with
4. **Engagement Analysis**: Use declining engagement to reconnect with users
5. **Privacy**: All data is stored locally and never shared

## Troubleshooting

### Common Issues:

1. **Metrics not updating**: Try refreshing the data
2. **Favorites not syncing**: Check localStorage permissions
3. **Slow performance**: Consider resetting old metrics
4. **Empty metrics**: Metrics build up over time with usage

### Reset Options:

- **Individual user**: Reset specific user's metrics
- **All metrics**: Nuclear option to start fresh
- **Favorites only**: Clear favorites without affecting metrics

## Security & Privacy

- All metrics are stored locally on your device
- No data is shared with external services
- Favorites are personal and private
- You have full control over your data

This comprehensive algorithm administration system gives you full control over your content recommendation experience while maintaining privacy and performance.
