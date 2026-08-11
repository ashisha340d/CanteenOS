import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import {
  Capability,
  LIMITS,
  TASK_SOURCE_LABELS,
  TaskKind,
  TaskPriority,
  UserRole,
  type MyTasksDto,
  type TaskDto,
  type TeamMemberActivityDto,
  type UserDto,
} from '@menuboard/shared';
import { tasksApi } from '../../src/api/tasks';
import { userRepository } from '../../src/db/repositories';
import { useCapabilities } from '../../src/permissions/useCapabilities';
import { CanteenTopBar } from '../../src/components/CanteenTopBar';
import { colors, fonts, radii, spacing } from '../../src/theme/tokens';

/**
 * My Tasks — the screen exists to answer one question: what am I doing right now?
 *
 * "Working On" owns the top of the screen and is never a list: exactly one task, or the
 * absence of one stated plainly. Everything else is a flat, scannable roll of available work
 * with a single verb per row. No charts, no calendar, and no deadline unless the work came
 * from an order that genuinely has one.
 */

const TABS = [
  { key: 'tasks', label: 'Tasks' },
  { key: 'activity', label: 'Activity' },
];

const EMPTY: MyTasksDto = { active: null, available: [], completedToday: [] };

/** 12:45 PM — the only time format on this screen. */
function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function freeLabel(member: TeamMemberActivityDto): string {
  if (member.status === 'OFF') return 'inactive';
  if (member.status === 'FREE') return 'free now';
  if (member.freeInMinutes === null) return 'working';
  if (member.freeInMinutes === 0) return 'free now';
  if (member.freeInMinutes < 60) return `free after ${member.freeInMinutes}m`;
  return `free after ${Math.round(member.freeInMinutes / 60)}h`;
}

export default function TasksScreen(): React.JSX.Element {
  const { has } = useCapabilities();
  // Employee and Super Admin have neither — they work what lands on their list (Employee) or
  // oversee the roster without carrying personal work on it (Super Admin). Everyone else can
  // at least raise their own to-do; TASK_ASSIGN additionally lets the composer hand it to an
  // Employee instead of (or as well as) keeping it for themselves.
  const canAuthor = has(Capability.TASK_SELF);
  const canAssign = has(Capability.TASK_ASSIGN);
  const canCreate = canAuthor || canAssign;

  const [tab, setTab] = useState('tasks');
  const [data, setData] = useState<MyTasksDto>(EMPTY);
  const [team, setTeam] = useState<TeamMemberActivityDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      const [mine, activity] = await Promise.all([tasksApi.mine(), tasksApi.teamActivity()]);
      setData(mine);
      setTeam(activity);
    } catch {
      // Online-only by design: leave the last good view on screen rather than blanking it.
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const act = useCallback(
    async (id: string, action: 'start' | 'stop' | 'complete') => {
      setBusyId(id);
      try {
        await tasksApi[action](id);
        await load();
      } catch (error) {
        const message =
          (error as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error
            ?.message ?? 'Could not reach the server. Try again.';
        Alert.alert('Not done', message);
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query === '') return data.available;
    return data.available.filter(
      (task) =>
        task.title.toLowerCase().includes(query) ||
        (task.orderNumber ?? '').toLowerCase().includes(query),
    );
  }, [data.available, search]);

  return (
    <View style={styles.screen}>
      <CanteenTopBar
        title="Canteen OS"
        tabs={TABS}
        activeTab={tab}
        onTabPress={setTab}
        onSearch={() => {
          setSearchOpen((open) => !open);
          setSearch('');
        }}
        onMenu={canCreate ? () => setComposerOpen(true) : undefined}
      />

      {searchOpen ? (
        <View style={styles.searchBar}>
          <MaterialIcons name="search" size={20} color={colors.taskMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search or start new task"
            placeholderTextColor={colors.taskMuted}
            style={styles.searchInput}
            autoFocus
          />
        </View>
      ) : null}

      {tab === 'tasks' ? (
        <FlatList
          data={visible}
          keyExtractor={(task) => task.id}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.taskAccent} />
          }
          ListHeaderComponent={
            <WorkingOn
              task={data.active}
              busy={busyId === data.active?.id}
              onComplete={() => data.active && act(data.active.id, 'complete')}
              onStop={() => data.active && act(data.active.id, 'stop')}
              onPick={canCreate ? () => setComposerOpen(true) : undefined}
              hasAvailable={data.available.length > 0}
            />
          }
          ListEmptyComponent={
            loading ? null : (
              <Text style={styles.emptyList}>
                {data.available.length === 0
                  ? 'No tasks assigned to you right now.'
                  : 'No task matches that search.'}
              </Text>
            )
          }
          renderItem={({ item }) => (
            <TaskRow
              task={item}
              busy={busyId === item.id}
              blocked={data.active !== null}
              onStart={() => act(item.id, 'start')}
            />
          )}
        />
      ) : (
        <FlatList
          data={team}
          keyExtractor={(member) => member.userId}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.taskAccent} />
          }
          renderItem={({ item }) => <ActivityRow member={item} />}
          ListEmptyComponent={
            loading ? null : <Text style={styles.emptyList}>Nobody on the roster yet.</Text>
          }
        />
      )}

      {tab === 'tasks' && canCreate ? (
        <Pressable
          onPress={() => setComposerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="New task"
          style={styles.fab}
        >
          <MaterialIcons name="add" size={28} color={colors.white} />
        </Pressable>
      ) : null}

      <TaskComposer
        open={composerOpen}
        canAssign={canAssign}
        onClose={() => setComposerOpen(false)}
        onCreated={async () => {
          setComposerOpen(false);
          await load();
        }}
      />
    </View>
  );
}

/* ------------------------------------------------------------------ working on */

function WorkingOn({
  task,
  busy,
  onComplete,
  onStop,
  onPick,
  hasAvailable,
}: {
  task: TaskDto | null;
  busy: boolean;
  onComplete: () => void;
  onStop: () => void;
  /** Absent for anyone without TASK_SELF/TASK_ASSIGN (Employee, Super Admin) — they work
   *  what is on their list rather than raising their own, so there is nothing to open. */
  onPick?: () => void;
  hasAvailable: boolean;
}): React.JSX.Element {
  if (task === null) {
    return (
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <MaterialIcons name="check-circle-outline" size={34} color={colors.taskAvatarFg} />
        </View>
        <Text style={styles.heroTitle}>Nothing in Progress</Text>
        <Text style={styles.heroSubtitle}>
          {onPick || hasAvailable
            ? 'You currently have no active tasks.'
            : 'Nothing has been assigned to you yet.'}
        </Text>
        {onPick ? (
          <Pressable onPress={onPick} accessibilityRole="button" style={styles.heroButton}>
            <Text style={styles.heroButtonLabel}>{hasAvailable ? 'Pick a Task' : 'Add a Task'}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.activeHero}>
      <Text style={styles.activeEyebrow}>Working On</Text>
      <Text style={styles.activeTitle} numberOfLines={2}>
        {task.title}
      </Text>
      <Text style={styles.activeMeta}>
        Source: {TASK_SOURCE_LABELS[task.source]}
        {task.startedAt !== null ? ` · since ${clock(task.startedAt)}` : ''}
      </Text>
      {task.dueAt !== null ? (
        <Text style={styles.activeDue}>Due {clock(task.dueAt)}</Text>
      ) : null}

      <View style={styles.activeActions}>
        <Pressable
          onPress={onComplete}
          disabled={busy}
          accessibilityRole="button"
          style={styles.activePrimary}
        >
          {busy ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.activePrimaryLabel}>FINISH</Text>
          )}
        </Pressable>
        <Pressable
          onPress={onStop}
          disabled={busy}
          accessibilityRole="button"
          style={styles.activeSecondary}
        >
          <Text style={styles.activeSecondaryLabel}>STOP</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------- task row */

function TaskRow({
  task,
  busy,
  blocked,
  onStart,
}: {
  task: TaskDto;
  busy: boolean;
  blocked: boolean;
  onStart: () => void;
}): React.JSX.Element {
  const isOrder = task.orderId !== null;
  return (
    <View style={styles.row}>
      <View style={styles.avatar}>
        <MaterialIcons
          name={
            task.kind === TaskKind.OFF_TIME
              ? 'schedule'
              : isOrder
                ? 'restaurant-menu'
                : 'person-outline'
          }
          size={20}
          color={colors.taskAvatarFg}
        />
      </View>

      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {task.title}
        </Text>
        <Text style={styles.rowSource} numberOfLines={1}>
          Source: {TASK_SOURCE_LABELS[task.source]}
        </Text>
      </View>

      <View style={styles.rowTrailing}>
        {task.dueAt !== null ? (
          <Text
            style={[styles.rowTime, task.priority === TaskPriority.HIGH && styles.rowTimeUrgent]}
          >
            {clock(task.dueAt)}
          </Text>
        ) : null}
        <Pressable
          onPress={onStart}
          disabled={busy || blocked}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Start ${task.title}`}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.taskAccent} />
          ) : (
            <Text style={[styles.startLabel, blocked && styles.startLabelBlocked]}>START</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------- activity */

function ActivityRow({ member }: { member: TeamMemberActivityDto }): React.JSX.Element {
  const urgent = member.currentTaskPriority === TaskPriority.HIGH;
  return (
    <View style={styles.row}>
      <View style={[styles.avatar, urgent && styles.avatarUrgent]}>
        <Text style={[styles.avatarText, urgent && styles.avatarTextUrgent]}>{member.initials}</Text>
      </View>

      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {member.name}
        </Text>
        <Text
          style={[styles.rowSource, urgent && styles.rowSourceUrgent]}
          numberOfLines={1}
        >
          {member.status === 'WORKING'
            ? `Working${urgent ? ' (High Priority)' : ''} - ${member.currentTaskTitle ?? ''}`
            : member.status === 'OFF'
              ? 'Currently inactive.'
              : member.lastTaskTitle !== null
                ? `Last task: ${member.lastTaskTitle}`
                : 'Ready for assignment - No current task'}
        </Text>
      </View>

      <View style={styles.rowTrailing}>
        <Text style={[styles.rowTime, urgent && styles.rowTimeUrgent]}>
          {member.startedAt !== null ? clock(member.startedAt) : '—'}
        </Text>
        <Text style={[styles.rowFree, urgent && styles.rowTimeUrgent]}>{freeLabel(member)}</Text>
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------- composer */

const SELF = '__self__';

function TaskComposer({
  open,
  canAssign,
  onClose,
  onCreated,
}: {
  open: boolean;
  /** Whether the picker below the form is shown at all — Employee and Super Admin never see
   *  it, and only ever raise (Employee: never) or work their own list. */
  canAssign: boolean;
  onClose: () => void;
  onCreated: () => void;
}): React.JSX.Element {
  const [title, setTitle] = useState('');
  const [minutes, setMinutes] = useState('');
  const [offTime, setOffTime] = useState(false);
  const [saving, setSaving] = useState(false);
  const [employees, setEmployees] = useState<UserDto[]>([]);
  /** Who this task goes to. Defaults to the author themselves. */
  const [targets, setTargets] = useState<Set<string>>(new Set([SELF]));

  useEffect(() => {
    if (!open || !canAssign) return;
    userRepository
      .listAll()
      .then((users) => setEmployees(users.filter((u) => u.role === UserRole.EMPLOYEE)))
      .catch(() => setEmployees([]));
  }, [open, canAssign]);

  const toggleTarget = (id: string): void => {
    setTargets((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // Never let the picker empty out entirely — falling back to "myself" is always safe.
      return next.size === 0 ? new Set([SELF]) : next;
    });
  };

  const submit = async (): Promise<void> => {
    if (title.trim() === '') return;
    setSaving(true);
    try {
      const estimate = Number(minutes);
      const estimatedMinutes = Number.isFinite(estimate) && estimate > 0 ? estimate : null;
      const kind = offTime ? TaskKind.OFF_TIME : TaskKind.WORK;

      // One task per recipient rather than one task with many owners: every screen in this
      // product (My Tasks, team activity, the single-active-task rule) already assumes a
      // task has exactly one assignee, so raising it for several people fans out into that
      // many independent rows instead of teaching every reader a new shape.
      const assignees = [...targets].filter((id) => id !== SELF);
      const wantsSelf = targets.has(SELF) || (assignees.length === 0 && !canAssign);
      const requests: Promise<unknown>[] = [];
      if (wantsSelf) {
        requests.push(tasksApi.create({ title: title.trim(), kind, estimatedMinutes }));
      }
      for (const assignedTo of assignees) {
        requests.push(tasksApi.create({ title: title.trim(), kind, estimatedMinutes, assignedTo }));
      }
      await Promise.all(requests);

      setTitle('');
      setMinutes('');
      setOffTime(false);
      setTargets(new Set([SELF]));
      onCreated();
    } catch {
      Alert.alert('Not saved', 'Could not reach the server. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const assignedElsewhere = canAssign && ![...targets].every((id) => id === SELF) && !targets.has(SELF);

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetScrim} onPress={onClose} />
      <View style={styles.sheet}>
        <Text style={styles.sheetTitle}>{canAssign ? 'New task' : 'New task for me'}</Text>
        <Text style={styles.sheetHint}>
          {assignedElsewhere
            ? 'Handed to somebody else, it carries no deadline unless it comes from an order.'
            : 'Self assigned work carries no deadline.'}
        </Text>

        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="What needs doing?"
          placeholderTextColor={colors.taskMuted}
          style={styles.sheetInput}
          maxLength={LIMITS.TASK_TITLE_MAX}
          autoFocus
        />
        <TextInput
          value={minutes}
          onChangeText={setMinutes}
          placeholder="Roughly how many minutes? (optional)"
          placeholderTextColor={colors.taskMuted}
          keyboardType="number-pad"
          style={styles.sheetInput}
        />

        <Pressable
          onPress={() => setOffTime((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: offTime }}
          style={styles.sheetToggle}
        >
          <MaterialIcons
            name={offTime ? 'check-box' : 'check-box-outline-blank'}
            size={22}
            color={offTime ? colors.taskAccent : colors.taskMuted}
          />
          <Text style={styles.sheetToggleLabel}>This is off time, not work</Text>
        </Pressable>

        {canAssign ? (
          <View style={styles.assigneeBlock}>
            <Text style={styles.assigneeLabel}>Assign to (pick one or more)</Text>
            <View style={styles.assigneeChips}>
              <AssigneeChip
                label="Myself"
                selected={targets.has(SELF)}
                onPress={() => toggleTarget(SELF)}
              />
              {employees.map((employee) => (
                <AssigneeChip
                  key={employee.id}
                  label={employee.name}
                  selected={targets.has(employee.id)}
                  onPress={() => toggleTarget(employee.id)}
                />
              ))}
            </View>
            {employees.length === 0 ? (
              <Text style={styles.assigneeEmpty}>No employees on the roster yet.</Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.sheetActions}>
          <Pressable onPress={onClose} style={styles.sheetCancel} accessibilityRole="button">
            <Text style={styles.sheetCancelLabel}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={submit}
            disabled={saving || title.trim() === ''}
            style={[styles.sheetSave, title.trim() === '' && styles.sheetSaveDisabled]}
            accessibilityRole="button"
          >
            {saving ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.sheetSaveLabel}>Add task</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function AssigneeChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      {selected ? (
        <MaterialIcons name="check" size={15} color={colors.white} style={styles.chipCheck} />
      ) : null}
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    margin: spacing[3],
    paddingHorizontal: spacing[3],
    borderRadius: radii.full,
    backgroundColor: colors.surfaceContainerLow,
  },
  searchInput: {
    flex: 1,
    paddingVertical: spacing[2.5],
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.onSurface,
  },

  /* hero */
  hero: {
    alignItems: 'center',
    paddingVertical: spacing[8],
    paddingHorizontal: spacing[6],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.taskRowDivider,
  },
  heroIcon: {
    width: 72,
    height: 72,
    borderRadius: radii.full,
    backgroundColor: colors.taskAvatar,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[4],
  },
  heroTitle: { fontFamily: fonts.sansBold, fontSize: 19, color: colors.onSurface },
  heroSubtitle: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.taskMuted,
    marginTop: spacing[1.5],
  },
  heroButton: {
    marginTop: spacing[5],
    paddingHorizontal: spacing[7],
    paddingVertical: spacing[3],
    borderRadius: radii.full,
    backgroundColor: colors.taskBar,
  },
  heroButtonLabel: { fontFamily: fonts.sansBold, fontSize: 15, color: colors.onTaskBar },

  activeHero: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[5],
    paddingBottom: spacing[5],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.taskRowDivider,
  },
  activeEyebrow: {
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 0.8,
    color: colors.taskAccent,
    textTransform: 'uppercase',
  },
  activeTitle: {
    fontFamily: fonts.sansBold,
    fontSize: 24,
    lineHeight: 30,
    color: colors.onSurface,
    marginTop: spacing[1.5],
  },
  activeMeta: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.taskMuted,
    marginTop: spacing[1],
  },
  activeDue: {
    fontFamily: fonts.sansBold,
    fontSize: 14,
    color: colors.taskUrgent,
    marginTop: spacing[1],
  },
  activeActions: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[5] },
  activePrimary: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing[3],
    borderRadius: radii.full,
    backgroundColor: colors.taskBar,
  },
  activePrimaryLabel: {
    fontFamily: fonts.sansBold,
    fontSize: 15,
    letterSpacing: 0.6,
    color: colors.onTaskBar,
  },
  activeSecondary: {
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[3],
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.taskRowDivider,
  },
  activeSecondaryLabel: {
    fontFamily: fonts.sansBold,
    fontSize: 15,
    letterSpacing: 0.6,
    color: colors.taskMuted,
  },

  /* rows */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    minHeight: 72,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.taskRowDivider,
    backgroundColor: colors.white,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radii.full,
    backgroundColor: colors.taskAvatar,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarUrgent: { backgroundColor: '#fde1ea' },
  avatarText: { fontFamily: fonts.sansBold, fontSize: 15, color: colors.taskAvatarFg },
  avatarTextUrgent: { color: colors.taskUrgent },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: fonts.sansBold, fontSize: 16, color: colors.onSurface },
  rowSource: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.taskMuted,
    marginTop: spacing[0.5],
  },
  rowSourceUrgent: { color: colors.taskUrgent, fontFamily: fonts.sansBold },
  rowTrailing: { alignItems: 'flex-end', gap: spacing[2], minWidth: 68 },
  rowTime: { fontFamily: fonts.sans, fontSize: 12, color: colors.taskMuted },
  rowTimeUrgent: { color: colors.taskUrgent, fontFamily: fonts.sansBold },
  rowFree: { fontFamily: fonts.sans, fontSize: 11, color: colors.taskMuted },
  startLabel: {
    fontFamily: fonts.sansBold,
    fontSize: 13,
    letterSpacing: 0.6,
    color: colors.taskAccent,
  },
  startLabelBlocked: { color: colors.outlineVariant },

  emptyList: {
    textAlign: 'center',
    marginTop: spacing[8],
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.taskMuted,
  },

  fab: {
    position: 'absolute',
    right: spacing[5],
    bottom: spacing[6],
    width: 56,
    height: 56,
    borderRadius: radii.full,
    backgroundColor: colors.taskFab,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },

  /* composer */
  sheetScrim: { flex: 1, backgroundColor: colors.scrim },
  sheet: {
    backgroundColor: colors.white,
    padding: spacing[5],
    gap: spacing[3],
    borderTopLeftRadius: radii['2xl'],
    borderTopRightRadius: radii['2xl'],
  },
  sheetTitle: { fontFamily: fonts.sansBold, fontSize: 18, color: colors.onSurface },
  sheetHint: { fontFamily: fonts.sans, fontSize: 13, color: colors.taskMuted },
  sheetInput: {
    borderWidth: 1,
    borderColor: colors.taskRowDivider,
    borderRadius: radii.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.onSurface,
  },
  sheetToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  sheetToggleLabel: { fontFamily: fonts.sans, fontSize: 14, color: colors.onSurface },

  assigneeBlock: { marginTop: spacing[4] },
  assigneeLabel: {
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.taskMuted,
    marginBottom: spacing[2],
  },
  assigneeChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  assigneeEmpty: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.taskMuted,
    marginTop: spacing[1],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.taskRowDivider,
    backgroundColor: colors.white,
  },
  chipSelected: { backgroundColor: colors.taskAccent, borderColor: colors.taskAccent },
  chipCheck: { marginRight: spacing[1] },
  chipLabel: { fontFamily: fonts.sansSemibold, fontSize: 13, color: colors.onSurface },
  chipLabelSelected: { color: colors.white },

  sheetActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing[3] },
  sheetCancel: { paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
  sheetCancelLabel: { fontFamily: fonts.sansBold, fontSize: 15, color: colors.taskMuted },
  sheetSave: {
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[3],
    borderRadius: radii.full,
    backgroundColor: colors.taskBar,
  },
  sheetSaveDisabled: { opacity: 0.5 },
  sheetSaveLabel: { fontFamily: fonts.sansBold, fontSize: 15, color: colors.onTaskBar },
});
