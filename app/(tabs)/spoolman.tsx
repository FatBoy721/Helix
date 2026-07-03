import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMoonraker } from '../../hooks/useMoonraker';
import { useSettings } from '../../hooks/useSettings';
import { api, normalizeBaseUrl, restartMoonraker, uploadConfigFile } from '../../services/moonraker';
import SpoolLabel from '../../components/SpoolLabel';
import SpoolScanner from '../../components/SpoolScanner';
import { t } from '../../services/i18n';
import { colors, spacing } from '../../constants/theme';

interface Vendor {
  id: number;
  name: string;
}

interface Filament {
  id: number;
  name?: string;
  material?: string;
  color_hex?: string;
  weight?: number;
  spool_weight?: number;
  diameter?: number;
  density?: number;
  price?: number;
  vendor?: Vendor;
}

interface Spool {
  id: number;
  remaining_weight?: number;
  used_weight?: number;
  location?: string;
  lot_nr?: string;
  price?: number;
  archived?: boolean;
  filament?: Filament;
}

const MATERIALS = [
  'PLA', 'PLA+', 'Silk PLA', 'Matte PLA', 'PLA-CF', 'Wood PLA',
  'PETG', 'PETG-CF', 'PCTG',
  'ABS', 'ASA', 'HIPS',
  'TPU', 'TPE',
  'PA', 'PA-CF', 'PA-GF', 'PC', 'PP', 'PVA', 'PVB',
];

// quick-pick brands — tapping one creates the vendor in Spoolman on save if
// it doesn't exist yet. spoolman itself has no built-in vendor list.
const PRESET_VENDORS = [
  'Snapmaker', 'Bambu Lab', 'Polymaker', 'eSUN', 'SUNLU', 'Overture',
  'Hatchbox', 'Prusament', 'Creality', 'Elegoo', 'Anycubic', 'Inland',
  'Eryone', 'Kingroon', 'Duramic', '3DXTech',
];
const COLOR_PRESETS = [
  '161616', 'FFFFFF', 'FB0207', 'FF7043', 'FFB300', '4CAF50', '2196F3', '0000FF',
  'AB47BC', 'EC407A', '8D6E63', '9E9E9E',
];

function spoolTitle(s: Spool): string {
  const parts = [s.filament?.vendor?.name, s.filament?.name].filter(Boolean);
  return parts.join(' ') || `Spool #${s.id}`;
}

function filamentTitle(f: Filament): string {
  return [f.vendor?.name, f.name, f.material].filter(Boolean).join(' ') || `Filament #${f.id}`;
}

export default function SpoolmanScreen() {
  const { connection, activeUrl } = useMoonraker();
  useSettings(); // re-render on language/theme change
  const [spools, setSpools] = useState<Spool[]>([]);
  const [filaments, setFilaments] = useState<Filament[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [unavailable, setUnavailable] = useState<'none' | 'no-component' | 'no-server'>('none');
  const [serverInput, setServerInput] = useState('');
  const [configuring, setConfiguring] = useState(false);
  const [spoolForm, setSpoolForm] = useState<{ spool: Spool | null } | null>(null);
  const [filamentForm, setFilamentForm] = useState<{ filament: Filament | null } | null>(null);
  const [labelSpool, setLabelSpool] = useState<Spool | null>(null);
  const [scanning, setScanning] = useState(false);

  const proxy = useCallback(
    async (method: string, path: string, body?: any) => {
      const res = await api.spoolmanProxy(activeUrl, method, path, body ? { body } : undefined);
      if (res?.error) throw new Error(res.error.message ?? JSON.stringify(res.error));
      return res?.response;
    },
    [activeUrl]
  );

  const refresh = useCallback(async () => {
    if (!activeUrl) return;
    setLoading(true);
    try {
      const idRes = await api.spoolmanGetSpoolId(activeUrl);
      setActiveId(idRes?.spool_id ?? null);
      const [sp, fil, ven] = await Promise.all([
        proxy('GET', '/v1/spool?allow_archived=true'),
        proxy('GET', '/v1/filament'),
        proxy('GET', '/v1/vendor'),
      ]);
      setSpools(Array.isArray(sp) ? sp : []);
      setFilaments(Array.isArray(fil) ? fil : []);
      setVendors(Array.isArray(ven) ? ven : []);
      setUnavailable('none');
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      setUnavailable(msg.includes('404') ? 'no-component' : 'no-server');
      setSpools([]);
      api
        .serverConfig(activeUrl)
        .then((c) => {
          const cur = c?.config?.spoolman?.server;
          if (cur) setServerInput(cur);
        })
        .catch(() => {});
    } finally {
      setLoading(false);
    }
  }, [activeUrl, proxy]);

  useEffect(() => {
    if (connection === 'connected') refresh();
  }, [connection, refresh]);

  // writes [spoolman] into the printer's moonraker config and restarts it —
  // so users never have to SSH anywhere to hook up their Spoolman server
  const configurePrinter = async () => {
    const server = normalizeBaseUrl(serverInput);
    if (!server) return;
    setConfiguring(true);
    try {
      await uploadConfigFile(
        activeUrl,
        'extended/moonraker',
        'spoolman.cfg',
        `# Spoolman filament tracking (written by Helix)\n[spoolman]\nserver: ${server}\nsync_rate: 5\n`
      );
      await restartMoonraker(activeUrl);
      await new Promise((r) => setTimeout(r, 8000));
      await refresh();
    } catch (e: any) {
      Alert.alert(t('Error'), String(e?.message ?? e));
    } finally {
      setConfiguring(false);
    }
  };

  const handleScanned = (id: number) => {
    setScanning(false);
    const spool = spools.find((s) => s.id === id);
    if (!spool) {
      Alert.alert(t('Error'), `${t('No spool with ID')} ${id}`);
      return;
    }
    setActive(spool);
  };

  const setActive = (spool: Spool | null) => {
    const label = spool ? spoolTitle(spool) : t('No spool active');
    Alert.alert(t('Set active spool?'), label, [
      { text: t('Cancel'), style: 'cancel' },
      {
        text: t('Set'),
        onPress: async () => {
          try {
            const res = await api.spoolmanSetSpoolId(activeUrl, spool?.id ?? null);
            setActiveId(res?.spool_id ?? null);
          } catch (e: any) {
            Alert.alert(t('Error'), String(e?.message ?? e));
          }
        },
      },
    ]);
  };

  if (connection === 'connected' && unavailable !== 'none' && !loading) {
    return (
      <View style={[styles.screen, styles.emptyScreen]}>
        <MaterialCommunityIcons name="paper-roll-outline" size={40} color={colors.subtext} />
        <Text style={styles.emptyTitle}>
          {unavailable === 'no-component'
            ? t('Spoolman not configured')
            : t('Spoolman server unreachable')}
        </Text>
        <Text style={styles.emptyText}>
          {unavailable === 'no-component'
            ? t('Enter your Spoolman server address and Helix will configure the printer for you.')
            : t('Moonraker is configured for Spoolman but the server is not responding. Check that the Spoolman container is running, or point the printer at a different address.')}
        </Text>
        <TextInput
          style={styles.setupInput}
          value={serverInput}
          onChangeText={setServerInput}
          placeholder="http://192.168.1.x:7912"
          placeholderTextColor={colors.subtext}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <TouchableOpacity
          style={[
            styles.configureBtn,
            { backgroundColor: colors.primary },
            (configuring || !serverInput.trim()) && { opacity: 0.5 },
          ]}
          disabled={configuring || !serverInput.trim()}
          onPress={configurePrinter}
        >
          <Text style={styles.configureText}>
            {configuring ? t('Configuring…') : t('Configure printer')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.retryBtn} onPress={refresh}>
          <Text style={styles.retryText}>{t('Retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const visible = spools.filter((s) => (showArchived ? true : !s.archived));
  const active = spools.find((s) => s.id === activeId) ?? null;

  return (
    <View style={styles.screen}>
      <FlatList
        contentContainerStyle={styles.content}
        data={visible}
        keyExtractor={(s) => String(s.id)}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.subtext} />
        }
        ListHeaderComponent={
          <>
            <View style={styles.activeCard}>
              <Text style={styles.activeLabel}>{t('Active spool')}</Text>
              {active ? (
                <SpoolRow
                  spool={active}
                  active
                  onPress={() => setActive(null)}
                  onEdit={() => setSpoolForm({ spool: active })}
                />
              ) : (
                <Text style={styles.noneActive}>{t('No spool active')}</Text>
              )}
            </View>
            <View style={styles.toolbar}>
              <TouchableOpacity
                style={[styles.toolBtn, { backgroundColor: colors.primary }]}
                onPress={() => setSpoolForm({ spool: null })}
              >
                <MaterialCommunityIcons name="plus" size={16} color="#fff" />
                <Text style={styles.toolBtnTextLight}>{t('Add spool')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.toolBtn}
                onPress={() => setFilamentForm({ filament: null })}
              >
                <MaterialCommunityIcons name="plus" size={16} color={colors.text} />
                <Text style={styles.toolBtnText}>{t('Add filament')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.toolBtn} onPress={() => setScanning(true)}>
                <MaterialCommunityIcons name="qrcode-scan" size={16} color={colors.text} />
                <Text style={styles.toolBtnText}>{t('Scan')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.archToggle}
                onPress={() => setShowArchived((v) => !v)}
              >
                <MaterialCommunityIcons
                  name={showArchived ? 'archive' : 'archive-outline'}
                  size={18}
                  color={showArchived ? colors.primary : colors.subtext}
                />
              </TouchableOpacity>
            </View>
          </>
        }
        ListEmptyComponent={
          !loading ? (
            <Text style={styles.empty}>
              {connection === 'connected' ? t('No spools in Spoolman yet') : t('Not connected')}
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <SpoolRow
            spool={item}
            active={item.id === activeId}
            onPress={() => setActive(item)}
            onEdit={() => setSpoolForm({ spool: item })}
            onLabel={() => setLabelSpool(item)}
          />
        )}
      />

      {spoolForm && (
        <SpoolFormModal
          spool={spoolForm.spool}
          filaments={filaments}
          proxy={proxy}
          onClose={(changed) => {
            setSpoolForm(null);
            if (changed) refresh();
          }}
        />
      )}
      {filamentForm && (
        <FilamentFormModal
          filament={filamentForm.filament}
          vendors={vendors}
          proxy={proxy}
          onClose={(changed) => {
            setFilamentForm(null);
            if (changed) refresh();
          }}
        />
      )}
      {labelSpool && (
        <SpoolLabel
          spoolId={labelSpool.id}
          title={spoolTitle(labelSpool)}
          material={labelSpool.filament?.material}
          colorHex={labelSpool.filament?.color_hex}
          onClose={() => setLabelSpool(null)}
        />
      )}
      {scanning && <SpoolScanner onScanned={handleScanned} onClose={() => setScanning(false)} />}
    </View>
  );
}

function SpoolRow({
  spool,
  active,
  onPress,
  onEdit,
  onLabel,
}: {
  spool: Spool;
  active?: boolean;
  onPress: () => void;
  onEdit: () => void;
  onLabel?: () => void;
}) {
  const remaining = spool.remaining_weight;
  const net = spool.filament?.weight;
  const pct =
    typeof remaining === 'number' && typeof net === 'number' && net > 0
      ? Math.max(0, Math.min(1, remaining / net))
      : null;

  return (
    <TouchableOpacity
      style={[
        styles.spoolCard,
        active && { borderColor: colors.primary },
        spool.archived && { opacity: 0.5 },
      ]}
      onPress={onPress}
    >
      <View
        style={[
          styles.colorDot,
          spool.filament?.color_hex
            ? { backgroundColor: `#${spool.filament.color_hex.replace('#', '')}` }
            : { borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' },
        ]}
      />
      <View style={styles.spoolInfo}>
        <Text style={styles.spoolName} numberOfLines={1}>
          {spoolTitle(spool)}
          {spool.archived ? `  (${t('Archived')})` : ''}
        </Text>
        <Text style={styles.spoolMeta}>
          {[
            spool.filament?.material,
            typeof remaining === 'number' ? `${Math.round(remaining)} g ${t('left')}` : null,
            spool.location || null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        {pct != null && (
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                {
                  width: `${Math.round(pct * 100)}%`,
                  backgroundColor: pct < 0.15 ? colors.danger : colors.primary,
                },
              ]}
            />
          </View>
        )}
      </View>
      {active && <MaterialCommunityIcons name="check-circle" size={20} color={colors.primary} />}
      {onLabel && (
        <TouchableOpacity style={styles.editBtn} onPress={onLabel}>
          <MaterialCommunityIcons name="qrcode" size={18} color={colors.subtext} />
        </TouchableOpacity>
      )}
      <TouchableOpacity style={styles.editBtn} onPress={onEdit}>
        <MaterialCommunityIcons name="pencil-outline" size={18} color={colors.subtext} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ---------- forms ----------

function FormModal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose}>
              <MaterialCommunityIcons name="close" size={22} color={colors.subtext} />
            </TouchableOpacity>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  numeric,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  numeric?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.fieldInput}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.subtext}
        keyboardType={numeric ? 'numeric' : 'default'}
        autoCapitalize="none"
      />
    </View>
  );
}

function SpoolFormModal({
  spool,
  filaments,
  proxy,
  onClose,
}: {
  spool: Spool | null;
  filaments: Filament[];
  proxy: (method: string, path: string, body?: any) => Promise<any>;
  onClose: (changed: boolean) => void;
}) {
  const editing = !!spool;
  const [filamentId, setFilamentId] = useState<number | null>(spool?.filament?.id ?? null);
  const [remaining, setRemaining] = useState(
    spool?.remaining_weight != null ? String(Math.round(spool.remaining_weight)) : ''
  );
  const [location, setLocation] = useState(spool?.location ?? '');
  const [lot, setLot] = useState(spool?.lot_nr ?? '');
  const [price, setPrice] = useState(spool?.price != null ? String(spool.price) : '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!filamentId) {
      Alert.alert(t('Error'), t('Pick a filament first'));
      return;
    }
    setSaving(true);
    try {
      const body: any = { filament_id: filamentId };
      if (remaining.trim()) body.remaining_weight = parseFloat(remaining);
      if (location.trim()) body.location = location.trim();
      if (lot.trim()) body.lot_nr = lot.trim();
      if (price.trim()) body.price = parseFloat(price);
      if (editing) await proxy('PATCH', `/v1/spool/${spool!.id}`, body);
      else await proxy('POST', '/v1/spool', body);
      onClose(true);
    } catch (e: any) {
      Alert.alert(t('Error'), String(e?.message ?? e));
      setSaving(false);
    }
  };

  const archive = async () => {
    try {
      await proxy('PATCH', `/v1/spool/${spool!.id}`, { archived: !spool!.archived });
      onClose(true);
    } catch (e: any) {
      Alert.alert(t('Error'), String(e?.message ?? e));
    }
  };

  const del = () => {
    Alert.alert(t('Delete spool?'), spoolTitle(spool!), [
      { text: t('Cancel'), style: 'cancel' },
      {
        text: t('Delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await proxy('DELETE', `/v1/spool/${spool!.id}`);
            onClose(true);
          } catch (e: any) {
            Alert.alert(t('Error'), String(e?.message ?? e));
          }
        },
      },
    ]);
  };

  return (
    <FormModal title={editing ? t('Edit spool') : t('Add spool')} onClose={() => onClose(false)}>
      <Text style={styles.fieldLabel}>{t('Filament')}</Text>
      <View style={styles.chipWrap}>
        {filaments.map((f) => (
          <TouchableOpacity
            key={f.id}
            style={[styles.pickChip, filamentId === f.id && { backgroundColor: colors.primary }]}
            onPress={() => setFilamentId(f.id)}
          >
            <View
              style={[
                styles.chipDot,
                { backgroundColor: `#${(f.color_hex ?? '888888').replace('#', '')}` },
              ]}
            />
            <Text style={[styles.pickChipText, filamentId === f.id && { color: '#fff' }]}>
              {filamentTitle(f)}
            </Text>
          </TouchableOpacity>
        ))}
        {!filaments.length && (
          <Text style={styles.hint}>{t('No filaments yet — add one first')}</Text>
        )}
      </View>
      <Field
        label={`${t('Remaining (g)')} — ${t('leave empty for a full spool')}`}
        value={remaining}
        onChange={setRemaining}
        placeholder="1000"
        numeric
      />
      <Field label={t('Location')} value={location} onChange={setLocation} placeholder="Shelf A" />
      <Field label={t('Lot number')} value={lot} onChange={setLot} />
      <Field label={t('Price')} value={price} onChange={setPrice} placeholder="19.99" numeric />

      <TouchableOpacity
        style={[styles.saveBtn, { backgroundColor: colors.primary }, saving && { opacity: 0.5 }]}
        disabled={saving}
        onPress={save}
      >
        <Text style={styles.saveText}>{t('Save')}</Text>
      </TouchableOpacity>
      {editing && (
        <View style={styles.dangerRow}>
          <TouchableOpacity style={styles.dangerBtn} onPress={archive}>
            <Text style={styles.dangerBtnText}>
              {spool!.archived ? t('Unarchive') : t('Archive')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dangerBtn} onPress={del}>
            <Text style={[styles.dangerBtnText, { color: colors.danger }]}>{t('Delete')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </FormModal>
  );
}

function FilamentFormModal({
  filament,
  vendors,
  proxy,
  onClose,
}: {
  filament: Filament | null;
  vendors: Vendor[];
  proxy: (method: string, path: string, body?: any) => Promise<any>;
  onClose: (changed: boolean) => void;
}) {
  const editing = !!filament;
  const [name, setName] = useState(filament?.name ?? '');
  const [material, setMaterial] = useState(filament?.material ?? 'PLA');
  const [materialCustom, setMaterialCustom] = useState(
    filament?.material && !MATERIALS.includes(filament.material) ? filament.material : ''
  );
  const [colorHex, setColorHex] = useState((filament?.color_hex ?? '2196F3').replace('#', ''));
  const [vendorId, setVendorId] = useState<number | null>(filament?.vendor?.id ?? null);
  const [newVendor, setNewVendor] = useState('');
  const [weight, setWeight] = useState(String(filament?.weight ?? 1000));
  const [diameter, setDiameter] = useState(String(filament?.diameter ?? 1.75));
  const [density, setDensity] = useState(String(filament?.density ?? 1.24));
  const [price, setPrice] = useState(filament?.price != null ? String(filament.price) : '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) {
      Alert.alert(t('Error'), t('Name is required'));
      return;
    }
    setSaving(true);
    try {
      let vid = vendorId;
      if (newVendor.trim()) {
        const v = await proxy('POST', '/v1/vendor', { name: newVendor.trim() });
        vid = v?.id ?? null;
      }
      const body: any = {
        name: name.trim(),
        material: materialCustom.trim() || material.trim() || 'PLA',
        color_hex: colorHex.replace('#', '') || '888888',
        weight: parseFloat(weight) || 1000,
        diameter: parseFloat(diameter) || 1.75,
        density: parseFloat(density) || 1.24,
      };
      if (vid) body.vendor_id = vid;
      if (price.trim()) body.price = parseFloat(price);
      if (editing) await proxy('PATCH', `/v1/filament/${filament!.id}`, body);
      else await proxy('POST', '/v1/filament', body);
      onClose(true);
    } catch (e: any) {
      Alert.alert(t('Error'), String(e?.message ?? e));
      setSaving(false);
    }
  };

  return (
    <FormModal
      title={editing ? t('Edit filament') : t('Add filament')}
      onClose={() => onClose(false)}
    >
      <Field label={t('Name')} value={name} onChange={setName} placeholder="PLA Black" />

      <Text style={styles.fieldLabel}>{t('Material')}</Text>
      <View style={styles.chipWrap}>
        {MATERIALS.map((m) => (
          <TouchableOpacity
            key={m}
            style={[
              styles.pickChip,
              material === m && !materialCustom.trim() && { backgroundColor: colors.primary },
            ]}
            onPress={() => {
              setMaterial(m);
              setMaterialCustom('');
            }}
          >
            <Text
              style={[
                styles.pickChipText,
                material === m && !materialCustom.trim() && { color: '#fff' },
              ]}
            >
              {m}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <Field
        label={t('Custom material')}
        value={materialCustom}
        onChange={setMaterialCustom}
        placeholder="PEEK, PETG-GF, …"
      />

      <Text style={styles.fieldLabel}>{t('Color')}</Text>
      <View style={styles.chipWrap}>
        {COLOR_PRESETS.map((c) => (
          <TouchableOpacity
            key={c}
            style={[
              styles.swatch,
              { backgroundColor: `#${c}` },
              colorHex.toUpperCase() === c && { borderWidth: 2, borderColor: colors.text },
            ]}
            onPress={() => setColorHex(c)}
          />
        ))}
      </View>
      <Field label={`${t('Color')} (hex)`} value={colorHex} onChange={setColorHex} placeholder="2196F3" />

      <Text style={styles.fieldLabel}>{t('Vendor')}</Text>
      <View style={styles.chipWrap}>
        {vendors.map((v) => (
          <TouchableOpacity
            key={v.id}
            style={[styles.pickChip, vendorId === v.id && { backgroundColor: colors.primary }]}
            onPress={() => {
              setVendorId(vendorId === v.id ? null : v.id);
              setNewVendor('');
            }}
          >
            <Text style={[styles.pickChipText, vendorId === v.id && { color: '#fff' }]}>
              {v.name}
            </Text>
          </TouchableOpacity>
        ))}
        {/* popular brands not in the DB yet — picking one creates it on save */}
        {PRESET_VENDORS.filter(
          (name) => !vendors.some((v) => v.name.toLowerCase() === name.toLowerCase())
        ).map((name) => (
          <TouchableOpacity
            key={name}
            style={[
              styles.pickChip,
              styles.presetChip,
              newVendor === name && { backgroundColor: colors.primary, borderColor: colors.primary },
            ]}
            onPress={() => {
              setNewVendor(newVendor === name ? '' : name);
              setVendorId(null);
            }}
          >
            <Text style={[styles.pickChipText, newVendor === name && { color: '#fff' }]}>
              {name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <Field
        label={t('New vendor')}
        value={newVendor}
        onChange={(v) => {
          setNewVendor(v);
          if (v.trim()) setVendorId(null);
        }}
        placeholder="Snapmaker"
      />

      <Field label={t('Net weight (g)')} value={weight} onChange={setWeight} numeric />
      <Field label={t('Diameter (mm)')} value={diameter} onChange={setDiameter} numeric />
      <Field label={t('Density (g/cm³)')} value={density} onChange={setDensity} numeric />
      <Field label={t('Price')} value={price} onChange={setPrice} numeric />

      <TouchableOpacity
        style={[styles.saveBtn, { backgroundColor: colors.primary }, saving && { opacity: 0.5 }]}
        disabled={saving}
        onPress={save}
      >
        <Text style={styles.saveText}>{t('Save')}</Text>
      </TouchableOpacity>
    </FormModal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.sm,
    paddingBottom: spacing.xl * 2,
  },
  activeCard: {
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  activeLabel: {
    color: colors.subtext,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  noneActive: {
    color: colors.subtext,
    fontSize: 13,
  },
  toolbar: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    alignItems: 'center',
  },
  toolBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.cardAlt,
    borderRadius: 8,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  toolBtnText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  toolBtnTextLight: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  archToggle: {
    marginLeft: 'auto',
    padding: spacing.sm,
  },
  spoolCard: {
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  colorDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  spoolInfo: {
    flex: 1,
  },
  spoolName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  spoolMeta: {
    color: colors.subtext,
    fontSize: 12,
    marginTop: 1,
  },
  track: {
    height: 4,
    backgroundColor: colors.cardAlt,
    borderRadius: 2,
    marginTop: 6,
    overflow: 'hidden',
  },
  fill: {
    height: 4,
    borderRadius: 2,
  },
  editBtn: {
    padding: 4,
  },
  empty: {
    color: colors.subtext,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  emptyScreen: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
  emptyText: {
    color: colors.subtext,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  setupInput: {
    alignSelf: 'stretch',
    backgroundColor: colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
    marginTop: spacing.md,
  },
  configureBtn: {
    alignSelf: 'stretch',
    borderRadius: 8,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  configureText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  retryBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.cardAlt,
    borderRadius: 8,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  retryText: {
    color: colors.text,
    fontWeight: '600',
  },
  modalWrap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: spacing.lg,
    maxHeight: '88%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  field: {
    marginBottom: spacing.md,
  },
  fieldLabel: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  fieldInput: {
    backgroundColor: colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  pickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.cardAlt,
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  pickChipText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  presetChip: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  swatch: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  hint: {
    color: colors.subtext,
    fontSize: 12,
  },
  saveBtn: {
    borderRadius: 8,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  saveText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  dangerRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  dangerBtn: {
    flex: 1,
    backgroundColor: colors.cardAlt,
    borderRadius: 8,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  dangerBtnText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
});
