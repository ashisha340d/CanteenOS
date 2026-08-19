import React from 'react';
import { Tabs } from 'expo-router';
import { TabBar } from '../../src/components/TabBar';

/**
 * Four destinations: Tasks, Boards, Orders, Users.
 *
 * Archive is no longer one of them. It is a *view of orders over a date window*, not a place
 * of its own, so it lives as a segment inside the Orders screen — reaching last week's orders
 * should not mean leaving the screen that shows this week's. A fifth tab also crowded the bar
 * enough that the labels truncated on a narrow phone.
 *
 * Home, Notifications and Settings are deliberately not tabs. Every mockup puts a gear and a
 * profile in the top app bar instead, and "Home" duplicated Boards — the board list *is* the
 * landing screen. Those three are now stack routes reached from `TopAppBar`.
 *
 * Chrome is drawn per-screen via `TopAppBar` rather than by the navigator, because the bar
 * differs by screen (brand mark vs back arrow, different actions) and the mockups show it
 * scrolling with content on some screens.
 */
export default function TabsLayout(): React.JSX.Element {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="tasks" options={{ title: 'Tasks' }} />
      <Tabs.Screen name="boards" options={{ title: 'Boards' }} />
      <Tabs.Screen name="orders" options={{ title: 'Orders' }} />
      <Tabs.Screen name="users" options={{ title: 'Users' }} />
    </Tabs>
  );
}
