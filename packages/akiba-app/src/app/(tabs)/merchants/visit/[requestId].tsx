// Recommend a place after a verified visit — the app's own version of the
// web visit card (hub-page /visit/:requestId), so the "How was it?" push and
// the store page's Recommend button no longer send the member to a website
// they aren't signed in to. Same questions, same order, same server rules
// (/api/v1/me/discovery-contributions/:id); the step logic lives in
// src/features/recommend/flow.ts.
//
// `edit=1` opens a saved visit for changes, starting at the first question
// and offering the private note, as the web edit does.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiRequestError, createApiClient } from '@/api';
import { useAuth } from '@/auth';
import type { ContributionRequest } from '@/contracts/contribution';
import { ActivityIndicator, Icon, PrimaryButton, TextButton, colors, fontFamily, radius } from '@/design-system';
import {
  MAX_ITEMS,
  MAX_PRIVATE_NOTE,
  MAX_RECOMMENDED_ITEMS,
  addItem,
  buildAnswers,
  initialDraft,
  localKey,
  nextStep,
  previousStep,
  removeItem,
  requestIsOpen,
  stepSequence,
  toggleExperienceOption,
  toggleRecommendedItem,
  type Draft,
  type Step,
} from '@/features/recommend/flow';
import { announceContributionSaved } from '@/features/recommend/saved-events';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; request: ContributionRequest };

const PARTY_SIZES: { label: string; value: number | null; sixPlus: boolean }[] = [
  { label: 'Just me', value: 1, sixPlus: false },
  { label: '2', value: 2, sixPlus: false },
  { label: '3', value: 3, sixPlus: false },
  { label: '4', value: 4, sixPlus: false },
  { label: '5', value: 5, sixPlus: false },
  { label: '6+', value: null, sixPlus: true },
];

function interpolate(template: string, merchantName: string) {
  return template.replace(/\{\{merchantName\}\}/g, merchantName);
}

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/merchants');
}

export default function RecommendVisitScreen() {
  const { requestId, edit } = useLocalSearchParams<{ requestId: string; edit?: string }>();
  const { accessToken } = useAuth();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  const load = useCallback(() => {
    if (!accessToken || !requestId) return;
    setState({ status: 'loading' });
    createApiClient({ accessToken })
      .getContributionRequest(requestId)
      .then((request) => setState({ status: 'ready', request }))
      .catch((error: unknown) =>
        setState({
          status: 'error',
          message:
            error instanceof ApiRequestError && error.status === 404
              ? 'This visit couldn’t be found.'
              : 'We couldn’t load your visit. Check your connection and try again.',
        }),
      );
  }, [accessToken, requestId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      {state.status === 'loading' ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.teal} />
        </View>
      ) : state.status === 'error' ? (
        <Message title="Something went wrong" body={state.message} primary={{ label: 'Try again', onPress: load }} />
      ) : !requestIsOpen(state.request) ? (
        <Message
          title="This visit has closed"
          body="Visits can be added for a limited time after you earn Miles. Your Miles are already yours."
          primary={{ label: 'Done', onPress: leave }}
        />
      ) : (
        <RecommendForm
          accessToken={accessToken}
          editing={edit === '1' && state.request.contribution !== null}
          request={state.request}
        />
      )}
    </SafeAreaView>
  );
}

function RecommendForm({
  accessToken,
  editing,
  request,
}: {
  accessToken: string | null;
  editing: boolean;
  request: ContributionRequest;
}) {
  const { template, merchant } = request;
  const [draft, setDraft] = useState<Draft>(() => initialDraft(request));
  const [step, setStep] = useState<Step>('recommend');
  const [itemDraft, setItemDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // A retry of the same answers reuses its key; changed answers get a new one.
  const lastSubmission = useRef<{ payload: string; key: string } | null>(null);

  const steps = useMemo(() => stepSequence(draft, template), [draft, template]);
  const position = steps.indexOf(step) + 1;

  const goNext = () => {
    const next = nextStep(step, draft, template);
    if (next) setStep(next);
  };
  const goBack = () => {
    const previous = previousStep(step, draft, template);
    if (previous) setStep(previous);
    else leave();
  };

  async function submit() {
    if (submitting || !accessToken) return;
    setSubmitting(true);
    setError(null);
    const answers = buildAnswers(draft, editing, '');
    const payload = JSON.stringify({ ...answers, idempotencyKey: undefined });
    if (lastSubmission.current?.payload !== payload) lastSubmission.current = { payload, key: localKey() };
    try {
      await createApiClient({ accessToken }).submitContribution(request.id, {
        ...answers,
        idempotencyKey: lastSubmission.current.key,
      });
      announceContributionSaved({ requestId: request.id, merchantSlug: merchant.slug, openPhotos: false });
      setSaved(true);
    } catch (caught) {
      const status = caught instanceof ApiRequestError ? caught.status : null;
      setError(
        status === 409 || status === 410
          ? 'This visit can no longer be changed.'
          : editing
            ? 'Couldn’t save your changes. Please try again.'
            : 'Couldn’t add your visit. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (saved) {
    const recommended = draft.wouldRecommend === true;
    return (
      <Message
        title={editing ? 'Changes saved' : `Visit added. Thanks for helping people discover ${merchant.name}.`}
        body={
          editing
            ? 'Your verified visit has been updated.'
            : recommended
              ? 'Your anonymous recommendation now appears in Verified visits. Broader public insights still require enough customers to agree.'
              : 'Your feedback was saved. Broader public insights appear only after enough customers contribute.'
        }
        primary={
          !editing && merchant.slug
            ? {
                label: 'Add photos',
                onPress: () => {
                  announceContributionSaved({ requestId: request.id, merchantSlug: merchant.slug, openPhotos: true });
                  leave();
                },
              }
            : { label: 'Done', onPress: leave }
        }
        secondary={!editing && merchant.slug ? { label: 'Done', onPress: leave } : undefined}
      />
    );
  }

  const submitLabel = editing ? 'Save changes' : 'Add to the Akiba guide';

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <View style={styles.topBar}>
        <Pressable accessibilityLabel="Back" accessibilityRole="button" hitSlop={8} onPress={goBack} style={styles.back}>
          <Icon color={colors.muted} name="arrow-left" size={18} />
        </Pressable>
        <Text accessibilityLiveRegion="polite" style={styles.progress}>
          {merchant.name} · {position} of {steps.length}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {step === 'recommend' ? (
          <>
            <Text accessibilityRole="header" style={styles.title}>
              {interpolate(template.recommendation_prompt, merchant.name)}
            </Text>
            <Text style={styles.hint}>
              {editing
                ? 'Recommendations and eligible details may appear publicly. Negative feedback stays private.'
                : 'Optional · Your Miles are already yours.'}
            </Text>
            <View style={styles.choices}>
              {[
                { label: 'Yes, I would', value: true },
                { label: 'Not this time', value: false },
              ].map((choice) => (
                <Choice
                  key={choice.label}
                  label={choice.label}
                  large
                  onPress={() => {
                    // Decide the destination from the value just chosen, not
                    // from a draft that hasn't updated yet.
                    const updated = { ...draft, wouldRecommend: choice.value };
                    setDraft(updated);
                    setStep(choice.value ? 'partySize' : 'negativeReason');
                  }}
                  selected={draft.wouldRecommend === choice.value}
                />
              ))}
            </View>
          </>
        ) : null}

        {step === 'negativeReason' ? (
          <>
            <Text accessibilityRole="header" style={styles.title}>What would help next time?</Text>
            <Text style={styles.hint}>Optional and private — never shown publicly.</Text>
            <View style={styles.chips}>
              {template.negative_reason_options.map((option) => (
                <Choice
                  key={option.id}
                  label={option.label}
                  onPress={() =>
                    setDraft({ ...draft, negativeReasonId: draft.negativeReasonId === option.id ? null : option.id })
                  }
                  selected={draft.negativeReasonId === option.id}
                />
              ))}
            </View>
            {editing ? <PrivateNote draft={draft} onChange={setDraft} /> : null}
          </>
        ) : null}

        {step === 'partySize' ? (
          <>
            <Text accessibilityRole="header" style={styles.title}>{template.party_size_prompt}</Text>
            <Text style={styles.hint}>Count the people whose food or items were on this bill.</Text>
            <View style={styles.grid}>
              {PARTY_SIZES.map((size) => (
                <Choice
                  key={size.label}
                  label={size.label}
                  onPress={() => setDraft({ ...draft, partySize: size.value, partySizeIsSixPlus: size.sixPlus })}
                  selected={size.sixPlus ? draft.partySizeIsSixPlus : !draft.partySizeIsSixPlus && draft.partySize === size.value}
                  wide
                />
              ))}
            </View>
          </>
        ) : null}

        {step === 'items' ? (
          <>
            <Text accessibilityRole="header" style={styles.title}>{template.item_prompt}</Text>
            <Text style={styles.hint}>Up to {MAX_ITEMS} items. You can also skip this.</Text>
            {draft.items.length < MAX_ITEMS ? (
              <View style={styles.addRow}>
                <TextInput
                  accessibilityLabel="Item name"
                  maxLength={80}
                  onChangeText={setItemDraft}
                  onSubmitEditing={() => {
                    setDraft(addItem(draft, itemDraft, localKey()));
                    setItemDraft('');
                  }}
                  placeholder="e.g. Chicken biryani"
                  placeholderTextColor="#8B8888"
                  returnKeyType="done"
                  style={[styles.input, styles.flex]}
                  value={itemDraft}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={!itemDraft.trim()}
                  onPress={() => {
                    setDraft(addItem(draft, itemDraft, localKey()));
                    setItemDraft('');
                  }}
                  style={[styles.addButton, !itemDraft.trim() && styles.disabled]}>
                  <Text style={styles.addButtonText}>Add</Text>
                </Pressable>
              </View>
            ) : null}
            <View style={styles.list}>
              {draft.items.map((item) => (
                <View key={item.clientItemKey} style={styles.itemRow}>
                  <Text style={[styles.itemLabel, styles.flex]}>{item.rawLabel}</Text>
                  <Pressable
                    accessibilityLabel={`Remove ${item.rawLabel}`}
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() => setDraft(removeItem(draft, item.clientItemKey))}>
                    <Icon color={colors.muted} name="x" size={18} />
                  </Pressable>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {step === 'recommendItems' ? (
          <>
            <Text accessibilityRole="header" style={styles.title}>{template.recommendation_item_prompt}</Text>
            <Text style={styles.hint}>Choose up to {MAX_RECOMMENDED_ITEMS}.</Text>
            <View style={styles.chips}>
              {draft.items.map((item) => (
                <Choice
                  key={item.clientItemKey}
                  label={item.rawLabel}
                  onPress={() => setDraft(toggleRecommendedItem(draft, item.clientItemKey))}
                  selected={item.isRecommended}
                />
              ))}
            </View>
          </>
        ) : null}

        {step === 'experienceTags' ? (
          <>
            <Text accessibilityRole="header" style={styles.title}>
              {interpolate(template.experience_prompt ?? '', merchant.name)}
            </Text>
            <Text style={styles.hint}>Choose up to {template.max_experience_options}.</Text>
            <View style={styles.chips}>
              {template.experience_options.map((option) => (
                <Choice
                  key={option.id}
                  label={option.inputLabel}
                  onPress={() => setDraft(toggleExperienceOption(draft, option.id, template.max_experience_options))}
                  selected={draft.experienceOptionIds.includes(option.id)}
                />
              ))}
            </View>
          </>
        ) : null}

        {step === 'review' ? (
          <>
            <Text accessibilityRole="header" style={styles.title}>{editing ? 'Review your changes' : 'Ready to add your visit?'}</Text>
            <View style={styles.summary}>
              <Summary
                label="Recommend"
                value={draft.wouldRecommend === true ? 'Yes, I would' : draft.wouldRecommend === false ? 'Not this time (private)' : 'Skipped'}
              />
              {draft.items.length > 0 ? (
                <Summary
                  label="Picks"
                  value={draft.items.map((item) => `${item.rawLabel}${item.isRecommended ? ' (recommended)' : ''}`).join(', ')}
                />
              ) : null}
              {draft.experienceOptionIds.length > 0 ? (
                <Summary
                  label="Great for"
                  value={template.experience_options
                    .filter((option) => draft.experienceOptionIds.includes(option.id))
                    .map((option) => option.inputLabel)
                    .join(', ')}
                />
              ) : null}
            </View>
            {editing ? <PrivateNote draft={draft} onChange={setDraft} /> : null}
            <Text style={styles.hint}>Your visit is anonymous. It never shows your name, the bill or what you paid.</Text>
          </>
        ) : null}

        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
      </ScrollView>

      {step !== 'recommend' ? (
        <View style={styles.footer}>
          {step === 'review' || step === 'negativeReason' ? (
            <PrimaryButton busy={submitting} busyLabel="Saving…" label={submitLabel} onPress={() => void submit()} />
          ) : (
            <PrimaryButton
              label={step === 'items' && draft.items.length === 0 ? 'Skip' : 'Continue'}
              onPress={goNext}
            />
          )}
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function PrivateNote({ draft, onChange }: { draft: Draft; onChange: (draft: Draft) => void }) {
  return (
    <View style={styles.noteBlock}>
      <Text style={styles.noteLabel}>Private note (optional)</Text>
      <TextInput
        accessibilityLabel="Private note"
        maxLength={MAX_PRIVATE_NOTE}
        multiline
        onChangeText={(privateNote) => onChange({ ...draft, privateNote })}
        placeholder="Only Akiba sees this"
        placeholderTextColor="#8B8888"
        style={[styles.input, styles.note]}
        value={draft.privateNote}
      />
    </View>
  );
}

function Choice({
  label,
  selected,
  onPress,
  large = false,
  wide = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  large?: boolean;
  wide?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        large && styles.choiceLarge,
        wide && styles.choiceWide,
        selected && styles.choiceSelected,
        pressed && styles.pressed,
      ]}>
      <Text style={[styles.choiceText, large && styles.choiceTextLarge]}>{label}</Text>
    </Pressable>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function Message({
  title,
  body,
  primary,
  secondary,
}: {
  title: string;
  body: string;
  primary: { label: string; onPress: () => void };
  secondary?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.message}>
      <View style={styles.messageIcon}>
        <Icon color={colors.teal} name="check-circle" size={26} />
      </View>
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      <Text style={styles.hint}>{body}</Text>
      <View style={styles.messageActions}>
        <PrimaryButton label={primary.label} onPress={primary.onPress} />
        {secondary ? <TextButton label={secondary.label} onPress={secondary.onPress} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.paper, flex: 1 },
  flex: { flex: 1 },
  centered: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  topBar: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 52, paddingHorizontal: 12 },
  back: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  progress: { color: colors.muted, flex: 1, fontFamily: fontFamily.sansMedium, fontSize: 13 },
  body: { gap: 12, paddingBottom: 24, paddingHorizontal: 20, paddingTop: 8 },
  title: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 24, lineHeight: 30 },
  hint: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 14, lineHeight: 20 },
  choices: { gap: 12, marginTop: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  choice: {
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.full,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
  },
  choiceLarge: { borderRadius: radius.md, minHeight: 56 },
  choiceWide: { alignItems: 'center', borderRadius: radius.md, minHeight: 52, width: '30%' },
  choiceSelected: { backgroundColor: colors.tint, borderColor: colors.teal },
  choiceText: { color: colors.ink, fontFamily: fontFamily.sansMedium, fontSize: 15 },
  choiceTextLarge: { fontFamily: fontFamily.sansSemiBold, fontSize: 16 },
  pressed: { opacity: 0.8 },
  addRow: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 8 },
  input: {
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: fontFamily.sans,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  addButton: {
    alignItems: 'center',
    backgroundColor: colors.tealDark,
    borderRadius: radius.md,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 18,
  },
  addButtonText: { color: colors.white, fontFamily: fontFamily.sansSemiBold, fontSize: 15 },
  disabled: { opacity: 0.4 },
  list: { gap: 8 },
  itemRow: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  itemLabel: { color: colors.ink, fontFamily: fontFamily.sans, fontSize: 15 },
  summary: { backgroundColor: colors.card, borderRadius: radius.md, gap: 12, padding: 16 },
  summaryRow: { gap: 2 },
  summaryLabel: { color: colors.muted, fontFamily: fontFamily.sansMedium, fontSize: 12 },
  summaryValue: { color: colors.ink, fontFamily: fontFamily.sans, fontSize: 15 },
  noteBlock: { gap: 6, marginTop: 8 },
  noteLabel: { color: colors.ink, fontFamily: fontFamily.sansMedium, fontSize: 14 },
  note: { minHeight: 96, paddingTop: 12, textAlignVertical: 'top' },
  error: { color: colors.danger, fontFamily: fontFamily.sansMedium, fontSize: 14 },
  footer: { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth, padding: 16 },
  message: { flex: 1, gap: 12, justifyContent: 'center', paddingHorizontal: 24 },
  messageIcon: {
    alignItems: 'center',
    backgroundColor: colors.tint,
    borderRadius: radius.full,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  messageActions: { gap: 8, marginTop: 12 },
});
