### Timeline

**Timeline/activity feed component for displaying chronological events.**

**Features:**
- Vertical and horizontal orientations
- Item markers (dots, icons, or custom content)
- Connecting lines between timeline items
- Item status states (pending, active, completed, error)
- Timestamps and descriptions support
- Custom content for each item
- ARIA list structure

**Basic Usage:**

```tsx
<Timeline orientation="vertical">
  <Timeline.Item status="completed">
    <Timeline.Marker />
    <Timeline.Connector />
    <Timeline.Content>
      <Timeline.Title>Event 1</Timeline.Title>
      <Timeline.Description>Event description</Timeline.Description>
      <Timeline.Timestamp>2 hours ago</Timeline.Timestamp>
    </Timeline.Content>
  </Timeline.Item>

  <Timeline.Item status="active">
    <Timeline.Marker />
    <Timeline.Connector />
    <Timeline.Content>
      <Timeline.Title>Event 2</Timeline.Title>
      <Timeline.Description>Current event</Timeline.Description>
      <Timeline.Timestamp>Just now</Timeline.Timestamp>
    </Timeline.Content>
  </Timeline.Item>

  <Timeline.Item status="pending">
    <Timeline.Marker />
    <Timeline.Content>
      <Timeline.Title>Event 3</Timeline.Title>
      <Timeline.Description>Upcoming event</Timeline.Description>
      <Timeline.Timestamp>In 1 hour</Timeline.Timestamp>
    </Timeline.Content>
  </Timeline.Item>
</Timeline>
```

**Advanced Usage:**

```tsx
// Order tracking timeline with custom icons
<Timeline orientation="vertical" class="order-timeline">
  <For each={orderEvents()}>
    {(event, index) => (
      <Timeline.Item status={event.status} class="order-event">
        <Timeline.Marker class="event-marker">
          <Show when={event.icon} fallback={<div class="marker-dot" />}>
            <img src={event.icon} alt={event.title} />
          </Show>
        </Timeline.Marker>

        <Show when={index() < orderEvents().length - 1}>
          <Timeline.Connector class="event-connector" />
        </Show>

        <Timeline.Content class="event-content">
          <div class="event-header">
            <Timeline.Title class="event-title">
              {event.title}
            </Timeline.Title>
            <Timeline.Timestamp class="event-time">
              {formatDate(event.timestamp)}
            </Timeline.Timestamp>
          </div>

          <Timeline.Description class="event-description">
            {event.description}
          </Timeline.Description>

          <Show when={event.details}>
            <div class="event-details">
              <For each={event.details}>
                {(detail) => (
                  <div class="detail-item">
                    <span class="detail-label">{detail.label}:</span>
                    <span class="detail-value">{detail.value}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Timeline.Content>
      </Timeline.Item>
    )}
  </For>
</Timeline>

// Activity feed with user avatars
<Timeline orientation="vertical" class="activity-feed">
  <For each={activities()}>
    {(activity) => (
      <Timeline.Item status={getActivityStatus(activity)}>
        <Timeline.Marker class="activity-marker">
          <Avatar>
            <Avatar.Image src={activity.user.avatar} />
            <Avatar.Fallback>{activity.user.initials}</Avatar.Fallback>
          </Avatar>
        </Timeline.Marker>

        <Timeline.Connector />

        <Timeline.Content class="activity-content">
          <Timeline.Title>
            <strong>{activity.user.name}</strong> {activity.action}
          </Timeline.Title>

          <Timeline.Description>
            {activity.description}
          </Timeline.Description>

          <Timeline.Timestamp>
            {formatRelativeTime(activity.timestamp)}
          </Timeline.Timestamp>

          <Show when={activity.attachment}>
            <div class="activity-attachment">
              {renderAttachment(activity.attachment)}
            </div>
          </Show>
        </Timeline.Content>
      </Timeline.Item>
    )}
  </For>
</Timeline>
```

**API:**

**`<Timeline>`** - Root container
- `orientation?: 'vertical' | 'horizontal'` - Timeline direction (default: 'vertical')

**`<Timeline.Item>`** - Timeline item
- `status?: 'pending' | 'active' | 'completed' | 'error'` - Item status (default: 'pending')

**`<Timeline.Marker>`** - Item marker (dot, icon, or custom content)

**`<Timeline.Connector>`** - Line connecting items

**`<Timeline.Content>`** - Item content container

**`<Timeline.Title>`** - Item title (h4 element)

**`<Timeline.Description>`** - Item description (p element)

**`<Timeline.Timestamp>`** - Item timestamp (time element)

---

