import type { ComponentProps } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import QRCode from 'react-native-qrcode-svg';

import { Icon, MaterialIcon, colors, fontFamily, shadows } from '@/design-system';

import { AkibaMark } from './chrome';

/**
 * The onboarding visuals are fragments of the app's own UI rather than
 * illustrations (the Stitch onboarding export). Everything here is
 * decorative sample content — hidden from screen readers, which get the
 * headline and body instead. Place names are fictional on purpose; real
 * merchants only appear here with their agreement.
 */

type MaterialName = ComponentProps<typeof MaterialIcon>['name'];

const decorative = {
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants' as const,
};

// ── Intro slide 1: place cards ────────────────────────────────────────────

function PlaceCard({
  name,
  category,
  icon,
  distance,
  rating,
  open,
  large,
}: {
  name: string;
  category: string;
  icon: MaterialName;
  distance: string;
  rating?: string;
  open?: boolean;
  large?: boolean;
}) {
  return (
    <View style={[styles.placeCard, large && styles.placeCardLarge]}>
      <LinearGradient colors={[colors.tint, '#CFEAEE']} style={[styles.placePhoto, large && styles.placePhotoLarge]}>
        <MaterialIcon name={icon} size={large ? 44 : 36} color={colors.teal} />
        <View style={styles.categoryChip}>
          <Text style={styles.categoryText}>{category}</Text>
        </View>
        {large ? (
          <View style={styles.bookmark}>
            <Icon name="bookmark" size={14} color={colors.ink} />
          </View>
        ) : null}
      </LinearGradient>
      <View style={styles.placeMeta}>
        <View style={styles.rowBetween}>
          <Text numberOfLines={1} style={[styles.placeName, large && styles.placeNameLarge]}>
            {name}
          </Text>
          {rating ? (
            <View style={styles.row}>
              <MaterialIcon name="star" size={14} color={colors.teal} />
              <Text style={styles.rating}>{rating}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.row}>
          <Icon name="navigation" size={12} color={colors.teal} />
          <Text style={styles.placeDetail}>{distance}</Text>
          {open ? <Text style={styles.placeDetail}>{'  •  Open now'}</Text> : null}
        </View>
      </View>
    </View>
  );
}

export function PlaceCardStack() {
  return (
    <View {...decorative} style={styles.stage}>
      <View style={[styles.layer, { transform: [{ translateX: -28 }, { translateY: -16 }, { rotate: '-6deg' }] }]}>
        <PlaceCard category="Restaurant" distance="3.4 km away" icon="silverware-fork-knife" name="The Green Terrace" />
      </View>
      <View style={[styles.layer, { transform: [{ translateX: 28 }, { translateY: 12 }, { rotate: '6deg' }] }]}>
        <PlaceCard category="Spa" distance="0.8 km away" icon="spa-outline" name="Zuri Spa" />
      </View>
      <View style={styles.layer}>
        <PlaceCard category="Café" distance="1.2 km away" icon="coffee-outline" large name="Kahawa Corner" open rating="4.8" />
      </View>
    </View>
  );
}

// ── Intro slide 2: offer cards ────────────────────────────────────────────

function OfferCard({ icon, title, detail, large }: { icon: MaterialName; title: string; detail: string; large?: boolean }) {
  return (
    <View style={[styles.offerCard, large && styles.offerCardLarge]}>
      <View style={styles.iconCircle}>
        <MaterialIcon name={icon} size={20} color={colors.teal} />
      </View>
      <View style={styles.flex}>
        <Text numberOfLines={1} style={[styles.offerTitle, large && styles.offerTitleLarge]}>
          {title}
        </Text>
        <Text numberOfLines={1} style={styles.offerDetail}>
          {detail}
        </Text>
      </View>
    </View>
  );
}

export function OfferCardStack() {
  return (
    <View {...decorative} style={styles.stage}>
      <View style={[styles.layer, { opacity: 0.95, transform: [{ translateY: -40 }, { rotate: '-6deg' }] }]}>
        <OfferCard detail="Kahawa Corner" icon="silverware-fork-knife" title="15% off lunch special" />
      </View>
      <View style={[styles.layer, { transform: [{ translateY: 16 }, { rotate: '2deg' }] }]}>
        <OfferCard detail="or KES 500 off your order" icon="glass-cocktail" large title="Free Dawa Cocktail" />
      </View>
    </View>
  );
}

// ── Pass card (intro slide 3 and the Pass-ready step) ─────────────────────

// Same brand colors as the Pass tab and the web QR.
const QR_DARK = '#0D3349';
const QR_LIGHT = '#FFFFFF';

export function PassCard({
  name,
  handle,
  code,
  qrValue,
  qrSize = 132,
  scannedAt,
  sample,
}: {
  name: string;
  handle?: string | null;
  code?: string | null;
  /** The live presentation token; null while it loads or if it failed. */
  qrValue: string | null;
  qrSize?: number;
  /** Shows the floating "Scanned at …" confirmation under the card. */
  scannedAt?: string;
  /** Intro sample: decorative, never a scannable member code. */
  sample?: boolean;
}) {
  return (
    <View {...(sample ? decorative : {})} style={styles.passWrap}>
      <View style={styles.passCard}>
        <View style={styles.passHeader}>
          <AkibaMark size={24} />
          <Text style={styles.passBrand}>Akiba Pass</Text>
        </View>
        <View style={styles.passMember}>
          <Text style={styles.passLabel}>MEMBER</Text>
          <Text numberOfLines={1} style={styles.passName}>
            {name}
          </Text>
          {handle ? <Text style={styles.passHandle}>{`@${handle}`}</Text> : null}
        </View>
        <View
          accessibilityLabel={sample ? undefined : 'Akiba Pass QR code'}
          accessible={!sample && !!qrValue}
          style={[styles.qrWell, { minHeight: qrSize + 24 }]}>
          {qrValue ? (
            <View style={styles.qrInner}>
              <QRCode backgroundColor={QR_LIGHT} color={QR_DARK} ecl="M" size={qrSize} value={qrValue} />
            </View>
          ) : (
            <ActivityIndicator color={colors.teal} />
          )}
        </View>
        {code ? <Text style={styles.passCode}>{code}</Text> : null}
      </View>
      {scannedAt ? (
        <View style={styles.scanned}>
          <View style={styles.scannedTick}>
            <Icon name="check" size={14} color={colors.teal} />
          </View>
          <Text numberOfLines={1} style={styles.scannedText}>
            {`Scanned at ${scannedAt}`}
            <Text style={styles.scannedTime}>{'  ·  just now'}</Text>
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ── Location step: map preview ────────────────────────────────────────────

function MapPin({ icon, label, style }: { icon: MaterialName; label: string; style: object }) {
  return (
    <View style={[styles.mapPin, style]}>
      <MaterialIcon name={icon} size={13} color={colors.teal} />
      <Text style={styles.mapPinText}>{label}</Text>
    </View>
  );
}

export function MapPreview() {
  return (
    <View {...decorative} style={styles.mapCard}>
      <View style={[styles.street, { height: 10, left: 0, right: 0, top: '38%' }]} />
      <View style={[styles.street, { height: 8, left: 0, right: 0, top: '72%' }]} />
      <View style={[styles.street, { bottom: 0, left: '30%', top: 0, width: 10 }]} />
      <View style={[styles.street, { bottom: 0, left: '68%', top: 0, width: 8 }]} />
      <View style={[styles.block, { height: 48, left: '6%', top: '8%', width: '20%' }]} />
      <View style={[styles.block, { height: 40, left: '74%', top: '46%', width: '22%' }]} />
      <View style={styles.youRing}>
        <View style={styles.youRingInner}>
          <View style={styles.youDot} />
        </View>
      </View>
      <MapPin icon="coffee-outline" label="Café · 300 m" style={{ left: '6%', top: '14%' }} />
      <MapPin icon="content-cut" label="Salon · 650 m" style={{ right: '6%', top: '24%' }} />
      <MapPin icon="silverware-fork-knife" label="Dining · 1.1 km" style={{ bottom: '10%', right: '8%' }} />
    </View>
  );
}

// ── Notifications step: notification cards ───────────────────────────────

function NotificationCard({ channel, time, title, body }: { channel: string; time: string; title: string; body?: string }) {
  return (
    <View style={styles.notification}>
      <View style={styles.rowBetween}>
        <View style={styles.row}>
          <AkibaMark size={18} />
          <Text style={styles.notificationApp}>{`Akiba · ${channel}`}</Text>
        </View>
        <Text style={styles.notificationTime}>{time}</Text>
      </View>
      <Text numberOfLines={1} style={styles.notificationTitle}>
        {title}
      </Text>
      {body ? (
        <Text numberOfLines={1} style={styles.notificationBody}>
          {body}
        </Text>
      ) : null}
    </View>
  );
}

export function NotificationStack() {
  return (
    <View {...decorative} style={styles.notificationStack}>
      <View style={styles.notificationBack}>
        <NotificationCard channel="Reminders" time="2h ago" title="Your voucher expires tomorrow" />
      </View>
      <NotificationCard
        body="20% off pastries today with any craft latte"
        channel="Offers"
        time="Now"
        title="Kahawa Corner has a new offer"
      />
    </View>
  );
}

// ── Pass-ready variant B: welcome voucher ticket ──────────────────────────

type WelcomeVoucherTicketProps = {
  discountPercent: number;
  maximumDiscountKes: number;
  minimumSpendKes: number;
  expiresAt: string;
};

const expiryDate = (value: string) =>
  new Date(value).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' });

/** The member's issued welcome voucher; every figure comes from the server. */
export function WelcomeVoucherTicket({
  discountPercent,
  maximumDiscountKes,
  minimumSpendKes,
  expiresAt,
}: WelcomeVoucherTicketProps) {
  const cap = `KES ${maximumDiscountKes.toLocaleString('en-KE')}`;
  const minimum = `KES ${minimumSpendKes.toLocaleString('en-KE')}`;
  const expires = expiryDate(expiresAt);
  return (
    <View
      accessible
      accessibilityLabel={`Welcome voucher: ${discountPercent}% off, up to ${cap}, on a bill of ${minimum} or more. Expires ${expires}.`}
      style={styles.ticket}>
      <View style={[styles.notch, styles.notchLeft]} />
      <View style={[styles.notch, styles.notchRight]} />
      <View style={styles.ticketSave}>
        <Text style={styles.ticketSmall}>SAVE</Text>
        <Text style={styles.ticketPercent}>
          {discountPercent}%<Text style={styles.ticketOff}> OFF</Text>
        </Text>
      </View>
      <View style={styles.ticketDivider} />
      <View style={styles.ticketRight}>
        <Text style={styles.ticketSmall}>UP TO {cap}</Text>
        <Text style={styles.ticketTitle}>Welcome voucher</Text>
        <View style={styles.expiryPill}>
          <Icon name="clock" size={11} color={colors.tealDark} />
          <Text style={styles.expiryText}>Expires {expires}</Text>
        </View>
      </View>
    </View>
  );
}

const cardBorder = { borderColor: 'rgba(13,14,12,0.05)', borderWidth: 1 };

const styles = StyleSheet.create({
  stage: {
    alignItems: 'center',
    height: '100%',
    justifyContent: 'center',
    width: '100%',
  },
  layer: {
    position: 'absolute',
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  rowBetween: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  flex: {
    flex: 1,
  },

  placeCard: {
    ...shadows.soft,
    ...cardBorder,
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: 12,
    width: 220,
  },
  placeCardLarge: {
    padding: 14,
    width: 245,
  },
  placePhoto: {
    alignItems: 'center',
    borderRadius: 14,
    height: 104,
    justifyContent: 'center',
    marginBottom: 10,
    overflow: 'hidden',
  },
  placePhotoLarge: {
    height: 124,
  },
  categoryChip: {
    backgroundColor: colors.teal,
    borderRadius: 999,
    left: 8,
    paddingHorizontal: 10,
    paddingVertical: 2,
    position: 'absolute',
    top: 8,
  },
  categoryText: {
    color: colors.white,
    fontFamily: fontFamily.sansBold,
    fontSize: 11,
  },
  bookmark: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    position: 'absolute',
    right: 8,
    top: 8,
    width: 28,
  },
  placeMeta: {
    gap: 4,
    paddingHorizontal: 2,
  },
  placeName: {
    color: colors.ink,
    flexShrink: 1,
    fontFamily: fontFamily.sansBold,
    fontSize: 15,
  },
  placeNameLarge: {
    fontSize: 16,
  },
  rating: {
    color: colors.ink,
    fontFamily: fontFamily.sansSemiBold,
    fontSize: 12,
  },
  placeDetail: {
    color: colors.muted,
    fontFamily: fontFamily.sans,
    fontSize: 12,
  },

  offerCard: {
    ...shadows.chip,
    ...cardBorder,
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 20,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    width: 240,
  },
  offerCardLarge: {
    ...shadows.soft,
    width: 270,
  },
  iconCircle: {
    alignItems: 'center',
    backgroundColor: colors.tint,
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  offerTitle: {
    color: colors.ink,
    fontFamily: fontFamily.sansBold,
    fontSize: 13,
  },
  offerTitleLarge: {
    fontSize: 14,
  },
  offerDetail: {
    color: colors.muted,
    fontFamily: fontFamily.sansMedium,
    fontSize: 11,
    marginTop: 2,
  },

  passWrap: {
    alignItems: 'center',
  },
  passCard: {
    ...shadows.soft,
    ...cardBorder,
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: 18,
    width: 270,
  },
  passHeader: {
    alignItems: 'center',
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 12,
  },
  passBrand: {
    color: colors.ink,
    fontFamily: fontFamily.sansBold,
    fontSize: 15,
  },
  passMember: {
    paddingVertical: 10,
  },
  passLabel: {
    color: '#8A9294',
    fontFamily: fontFamily.sansSemiBold,
    fontSize: 10,
    letterSpacing: 0.8,
  },
  passName: {
    color: colors.ink,
    fontFamily: fontFamily.sansSemiBold,
    fontSize: 14,
  },
  passHandle: {
    color: colors.tealDark,
    fontFamily: fontFamily.sansMedium,
    fontSize: 12,
  },
  qrWell: {
    alignItems: 'center',
    backgroundColor: '#FAFAFA',
    borderColor: '#EEEEEE',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
  },
  qrInner: {
    backgroundColor: QR_LIGHT,
    padding: 6,
  },
  passCode: {
    color: '#8A9294',
    fontFamily: fontFamily.sans,
    fontSize: 11,
    letterSpacing: 0.4,
    marginTop: 10,
    textAlign: 'center',
  },
  scanned: {
    ...shadows.chip,
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: '#E5F1F2',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginTop: -18,
    maxWidth: 290,
    paddingLeft: 8,
    paddingRight: 14,
    paddingVertical: 7,
  },
  scannedTick: {
    alignItems: 'center',
    backgroundColor: colors.tint,
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  scannedText: {
    color: colors.ink,
    flexShrink: 1,
    fontFamily: fontFamily.sansSemiBold,
    fontSize: 13,
  },
  scannedTime: {
    color: colors.muted,
    fontFamily: fontFamily.sans,
    fontSize: 12,
  },

  mapCard: {
    ...shadows.soft,
    ...cardBorder,
    backgroundColor: '#F4F8F8',
    borderRadius: 24,
    height: '100%',
    overflow: 'hidden',
    width: 290,
  },
  street: {
    backgroundColor: colors.white,
    position: 'absolute',
  },
  block: {
    backgroundColor: '#E6F0F1',
    borderRadius: 8,
    position: 'absolute',
  },
  youRing: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(35,141,157,0.10)',
    borderRadius: 48,
    height: 96,
    justifyContent: 'center',
    marginTop: -48,
    position: 'absolute',
    top: '50%',
    width: 96,
  },
  youRingInner: {
    alignItems: 'center',
    backgroundColor: 'rgba(35,141,157,0.18)',
    borderRadius: 26,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  youDot: {
    backgroundColor: colors.teal,
    borderColor: colors.white,
    borderRadius: 10,
    borderWidth: 4,
    height: 20,
    width: 20,
  },
  mapPin: {
    ...shadows.chip,
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    position: 'absolute',
  },
  mapPinText: {
    color: colors.ink,
    fontFamily: fontFamily.sansSemiBold,
    fontSize: 11,
  },

  notificationStack: {
    paddingTop: 22,
    width: 300,
  },
  notificationBack: {
    left: 12,
    opacity: 0.85,
    position: 'absolute',
    right: 12,
    top: 0,
  },
  notification: {
    ...shadows.soft,
    ...cardBorder,
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderRadius: 18,
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  notificationApp: {
    color: colors.muted,
    fontFamily: fontFamily.sansMedium,
    fontSize: 11,
    marginLeft: 2,
  },
  notificationTime: {
    color: colors.muted,
    fontFamily: fontFamily.sans,
    fontSize: 11,
  },
  notificationTitle: {
    color: colors.ink,
    fontFamily: fontFamily.sansBold,
    fontSize: 14,
    marginTop: 4,
  },
  notificationBody: {
    color: colors.muted,
    fontFamily: fontFamily.sans,
    fontSize: 12,
  },

  ticket: {
    ...shadows.soft,
    alignItems: 'center',
    backgroundColor: colors.tealDark,
    borderRadius: 18,
    flexDirection: 'row',
    overflow: 'hidden',
    paddingHorizontal: 20,
    paddingVertical: 18,
    width: 290,
  },
  notch: {
    backgroundColor: colors.paper,
    borderRadius: 10,
    height: 20,
    position: 'absolute',
    top: '50%',
    marginTop: -10,
    width: 20,
  },
  notchLeft: {
    left: -10,
  },
  notchRight: {
    right: -10,
  },
  ticketSave: {
    width: 96,
  },
  ticketSmall: {
    color: 'rgba(255,255,255,0.8)',
    fontFamily: fontFamily.sansBold,
    fontSize: 10,
    letterSpacing: 1,
  },
  ticketPercent: {
    color: colors.white,
    fontFamily: fontFamily.sansBold,
    fontSize: 30,
  },
  ticketOff: {
    fontSize: 14,
  },
  ticketDivider: {
    alignSelf: 'stretch',
    borderColor: 'rgba(255,255,255,0.45)',
    borderLeftWidth: 1,
    borderStyle: 'dashed',
    marginHorizontal: 14,
  },
  ticketRight: {
    flex: 1,
    gap: 4,
  },
  ticketTitle: {
    color: colors.white,
    fontFamily: fontFamily.sansBold,
    fontSize: 16,
  },
  expiryPill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.white,
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  expiryText: {
    color: colors.tealDark,
    fontFamily: fontFamily.sansSemiBold,
    fontSize: 11,
  },
});
