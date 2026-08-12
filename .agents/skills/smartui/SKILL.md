# Canteen OS Development Skills

This skill configuration applies to the complete Canteen OS codebase.

Canteen OS contains:

1. Canteen OS Web
2. Canteen OS Expo / React Native Mobile App
3. Shared backend/API/services

Maintain the correct technology for each platform.

WEB APPLICATION

The Canteen OS web application uses Smart UI Community Edition as its primary UI component system.

Keep and use capabilities for:

Frontend development
React
TypeScript
Smart UI Community Edition
Smart UI Web Components
UI component migration
UI architecture
CSS
Themes
Skins
Responsive UI
Accessibility
Frontend performance
State management
API integration
Browser testing
E2E testing

Smart UI must be used for appropriate web UI components wherever a Community Edition equivalent exists.

Do not introduce Professional, Enterprise, paid, or trial-only Smart UI functionality.

Do not assume a feature exists in Community Edition without verifying the actual installed package/version.

MOBILE APPLICATION

The Canteen OS mobile application is an Expo / React Native application.

Keep and use capabilities for:

Expo
React Native
TypeScript
Expo Router if used by the existing application
React Native navigation
React Native UI
Mobile gestures
Mobile animations
Mobile state management
Mobile API integration
Expo build workflows
Android
iOS where applicable
Mobile performance
Mobile accessibility
Mobile testing
E2E mobile testing

Do not migrate the Expo mobile application to Smart UI Web Components.

Do not force web UI components into the native mobile application.

The mobile application must remain a proper Expo / React Native application.

CANTEEN OS MOBILE UX REQUIREMENT

The Canteen OS mobile application must have a WhatsApp-like interaction model and overall UX familiarity.

Use WhatsApp as the UX reference for interaction patterns, information hierarchy, navigation behavior, messaging behavior, and mobile ergonomics.

Do not copy WhatsApp proprietary branding, logos, icons, assets, source code, or exact visual identity.

The target is WhatsApp-like UX behavior, not a visual clone.

The mobile experience should use familiar patterns such as:

Conversation-first navigation
Chat list
Conversation screen
Message bubbles
Message grouping
Unread counts
Unread separators
Read/seen states where applicable
Typing/input behavior
Persistent message composer
Attachment/media actions
Camera/gallery interaction
Voice/message actions where applicable
Swipe gestures
Long-press contextual actions
Message context menus
Reply-to-message behavior
Forward/share behavior where applicable
Search
Conversation search
Pinned conversations where applicable
Archived conversations where applicable
Mute/notification controls where applicable
Message timestamps
Date separators
Infinite/virtualized message history
Optimistic message sending
Sending state
Delivered state
Read state
Failed state
Retry
Offline-aware behavior
Network reconnection
Push notifications
Deep linking into conversations
Notification navigation
Unread synchronization
Background synchronization
Pull-to-refresh where appropriate
Keyboard-aware layouts
Keyboard dismissal
Safe-area handling
Touch-friendly controls
Native mobile gestures
Smooth transitions
Native-feeling animations
Mobile loading states
Empty states
Error states

The UX must feel native to a modern messaging application.

Avoid desktop-web behavior inside the mobile application.

Do not use tiny desktop controls.

Do not use desktop-style dense tables on mobile.

Do not reproduce web sidebars where a native mobile navigation pattern is more appropriate.

Use native React Native components and Expo capabilities for mobile interactions.

The mobile app should maintain consistent interaction patterns throughout all modules.

If the application contains operational workflows such as orders, tasks, notifications, staff communication, kitchen communication, or other conversation-based workflows, present them using the appropriate mobile interaction patterns rather than simply shrinking the web interface.

SHARED ARCHITECTURE

Keep shared:

API contracts
Authentication
Authorization
Business logic
Data models
Validation rules
Network services
Relevant state/data services

Do not duplicate business logic unnecessarily between Web and Mobile.

Keep platform-specific presentation separate.

SKILLS TO KEEP

Web:
Frontend
React
TypeScript
Smart UI Community Edition
Smart UI Web Components
CSS
Themes
Skins
Responsive UI
Accessibility
Frontend performance
Browser testing
E2E testing

Mobile:
Expo
React Native
TypeScript
Expo Router if applicable
Mobile UI
Mobile UX
Navigation
Gestures
Animations
Push notifications
Deep linking
Mobile API integration
Mobile performance
Android
iOS where applicable
Mobile testing
E2E testing

Shared:
Refactoring
Code quality
Testing
Debugging
Git
GitHub
Dependency management
Build verification
API integration

DO NOT USE FOR THIS TASK

Do not search for or install additional skills unless a genuinely missing capability blocks implementation.

Do not install documentation skills.

Do not install README skills.

Do not install changelog skills.

Do not install technical-writing skills.

Do not install architecture-documentation skills.

Do not install design-documentation skills.

Do not install generic skill-discovery skills.

Do not install unrelated framework skills.

Do not install unrelated DevOps skills unless deployment is explicitly required.

Do not install unrelated database skills unless database inspection is required.

Do not waste ACUs searching for skills unrelated to the current implementation.

DOCUMENTATION

Do not create documentation during implementation.

Do not create README files.

Do not create migration reports.

Do not create architecture documents.

Do not create changelogs.

Do not create technical documentation.

Documentation will be created separately after implementation is stable.

PLATFORM RULE

Before modifying code, determine whether it belongs to:

Canteen OS Web
Canteen OS Expo Mobile
Shared code

Use Smart UI for the Web application.

Use Expo / React Native for the Mobile application.

Do not mix platform-specific UI technologies.

Do not rewrite working mobile architecture merely to make it visually similar to the Web application.

The Web and Mobile applications should share the same Canteen OS product identity, data, business behavior, terminology, permissions, and workflows while using platform-appropriate UI.

MOBILE QUALITY TARGET

The mobile application should feel like a purpose-built messaging application rather than a responsive web application packaged inside Expo.

Prioritize:

Fast startup
Smooth scrolling
60 FPS interaction where practical
Virtualized lists
Optimistic interactions
Reliable message synchronization
Offline/reconnection handling
Keyboard correctness
Gesture correctness
Push notification behavior
Deep linking
Native navigation
Touch ergonomics
Consistent mobile interaction patterns

The final mobile UX should feel immediately familiar to users accustomed to WhatsApp while remaining distinctly branded and designed for Canteen OS.


Keep the platform separation exactly as you have it.

Make Smart UI Community Edition a hard Web-only rule.

Make the mobile WhatsApp-like requirement an explicit UX target, while allowing Canteen OS-specific workflows.

Add one important execution rule: inspect first, then execute; do not spend excessive time producing analysis before making changes.

I would also remove the repeated “skills to keep” sections. Devin already knows its available skills; the important thing is defining which capabilities it should use and which it should avoid.

The biggest addition I recommend is:

“Do not optimize for theoretical completeness. Prioritize implementation speed, correctness, and removal of redundant code. Make decisions autonomously when the existing codebase provides enough evidence.”

That will help prevent Devin from burning ACUs endlessly analyzing the repository.

Your current configuration is approximately 8/10. With that polish, I would consider it ready for the migration.