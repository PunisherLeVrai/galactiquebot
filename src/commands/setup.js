// src/commands/setup.js
// Setup PROSYNC — multi-serveur — STAFF ONLY
// CommonJS — discord.js v14

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');

const { getGuildConfig, upsertGuildConfig } = require('../core/guildConfig');

const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const DAY_INDEX = { Lun: 0, Mar: 1, Mer: 2, Jeu: 3, Ven: 4, Sam: 5, Dim: 6 };
const PRESET_TIMES = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`);
const SESSIONS = new Map();
let LISTENER_READY = false;

function isStaff(member, config) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  return (Array.isArray(config?.staffRoleIds) ? config.staffRoleIds : []).some((id) =>
    member.roles?.cache?.has?.(String(id))
  );
}

function uniqIds(input, max = 25) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(input) ? input : []) {
    const id = String(value || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

function isSnowflake(value) {
  return /^[0-9]{15,25}$/.test(String(value || '').trim());
}

function normalizeMessageIds(input) {
  const src = Array.isArray(input) ? input : [];
  return Array.from({ length: 7 }, (_, i) => (isSnowflake(src[i]) ? String(src[i]) : null));
}

function normalizeWarningRoleIds(input) {
  const src = Array.isArray(input) ? input : [];
  const out = [null, null, null];
  const seen = new Set();
  for (let i = 0; i < 3; i++) {
    const id = isSnowflake(src[i]) ? String(src[i]) : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out[i] = id;
  }
  return out;
}

function normalizeTime(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function normalizeTimes(input, max = 12) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(input) ? input : []) {
    const time = normalizeTime(value);
    if (!time || seen.has(time)) continue;
    seen.add(time);
    out.push(time);
    if (out.length >= max) break;
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function clampMinute(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 10;
  return Math.max(0, Math.min(59, Math.trunc(number)));
}

function fmtChannel(id) {
  return id ? `<#${id}>` : '—';
}

function fmtRoles(ids) {
  const values = Array.isArray(ids) ? ids.filter(Boolean) : [];
  return values.length ? values.map((id) => `<@&${id}>`).join(' ') : '—';
}

function fmtTimes(values) {
  return values?.length ? values.map((time) => `\`${time}\``).join(' ') : '—';
}

function fmtMessageIds(ids) {
  return DAYS.map((day, index) => `${day}: ${ids[index] ? `\`${ids[index]}\`` : '—'}`).join('\n');
}

function parseScope(customId) {
  const parts = String(customId || '').split(':');
  if (parts.length < 4) return null;
  const userId = parts.at(-1);
  const guildId = parts.at(-2);
  if (!isSnowflake(userId) || !isSnowflake(guildId)) return null;
  return `${guildId}:${userId}`;
}

function opensModal(customId) {
  return /setup:(modal|btn:(confirmSave|openMinute|idsA|idsB))/.test(String(customId || ''));
}

function buildEmbed(guild, draft, page, dirty) {
  const warningIds = normalizeWarningRoleIds(draft.automations.avertissement.roleIds);
  const checkTimes = normalizeTimes(draft.automations.checkDispo.times);
  const lastCheck = checkTimes.at(-1) || null;
  const requiredOk = Boolean(
    draft.disposChannelId &&
      draft.staffReportsChannelId &&
      draft.staffRoleIds.length &&
      draft.playerRoleIds.length
  );

  return new EmbedBuilder()
    .setTitle(`⚙️ PROSYNC Setup — ${guild.name}`)
    .setColor(0xed4245)
    .setDescription(
      `${requiredOk ? '✅ Configuration minimale complète' : '⚠️ Configuration incomplète'}\n` +
        `Page : **${page}**${dirty ? '\n⚠️ Modifications non sauvegardées' : ''}\n\n` +
        'Progression : Avertissement 1 → 2 → 3. Un joueur qui répond est régularisé.'
    )
    .addFields(
      {
        name: 'Salons',
        value: [
          `📅 Dispos : ${fmtChannel(draft.disposChannelId)}`,
          `📊 Rapports staff : ${fmtChannel(draft.staffReportsChannelId)}`,
          `🎮 Pseudos : ${fmtChannel(draft.pseudoScanChannelId)}`,
          `🗓️ Check Dispo : ${fmtChannel(draft.checkDispoChannelId)}`,
        ].join('\n'),
      },
      {
        name: 'Rôles',
        value: [
          `🛡️ Staff : ${fmtRoles(draft.staffRoleIds)}`,
          `👟 Joueurs : ${fmtRoles(draft.playerRoleIds)}`,
          `📌 Postes : ${fmtRoles(draft.postRoleIds)}`,
        ].join('\n'),
      },
      { name: '✉️ IDs messages', value: fmtMessageIds(draft.dispoMessageIds) },
      {
        name: 'Automations',
        value: [
          `Global : **${draft.automations.enabled ? 'ON' : 'OFF'}**`,
          `Pseudo : **${draft.automations.pseudo.enabled ? 'ON' : 'OFF'}** — minute \`${draft.automations.pseudo.minute}\``,
          `Check : **${draft.automations.checkDispo.enabled ? 'ON' : 'OFF'}** — ${fmtTimes(checkTimes)}`,
          `Rappel : **${draft.automations.rappel.enabled ? 'ON' : 'OFF'}** — ${fmtTimes(draft.automations.rappel.times)}`,
          `Avertissement : **${draft.automations.avertissement.enabled ? 'ON' : 'OFF'}** — dernier check ${lastCheck ? `\`${lastCheck}\`` : '—'}`,
          `1️⃣ ${warningIds[0] ? `<@&${warningIds[0]}>` : '—'}`,
          `2️⃣ ${warningIds[1] ? `<@&${warningIds[1]}>` : '—'}`,
          `3️⃣ ${warningIds[2] ? `<@&${warningIds[2]}>` : '—'}`,
        ].join('\n'),
      }
    )
    .setFooter({ text: 'PROSYNC' });
}

function minuteModal(customId, value) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle('Minute automation Pseudo')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('minute')
          .setLabel('Minute de 0 à 59')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(clampMinute(value)))
      )
    );
}

function idsModal(customId, days, ids, title) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title);
  modal.addComponents(
    ...days.map((day) =>
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(day)
          .setLabel(`${day} — ID message`)
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(ids[DAY_INDEX[day]] || '')
      )
    )
  );
  return modal;
}

function confirmModal(customId) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle('Confirmation PROSYNC')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('confirm')
          .setLabel('Tape CONFIRMER')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function ensureGlobalSetupListener(client) {
  if (LISTENER_READY || !client?.on) return;
  LISTENER_READY = true;

  client.on('interactionCreate', async (interaction) => {
    try {
      if (!interaction?.inGuild?.()) return;
      const isComponent = interaction.isButton?.() || interaction.isStringSelectMenu?.() || interaction.isRoleSelectMenu?.() || interaction.isChannelSelectMenu?.();
      const isModal = interaction.isModalSubmit?.();
      if (!isComponent && !isModal) return;
      if (!String(interaction.customId || '').startsWith('setup:')) return;

      const scope = parseScope(interaction.customId);
      const session = scope ? SESSIONS.get(scope) : null;
      if (!session) {
        if (isComponent && !interaction.deferred && !interaction.replied) await interaction.deferUpdate().catch(() => {});
        return interaction.followUp({ content: '⚠️ Session /setup expirée.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }

      if (String(interaction.user.id) !== session.userId || String(interaction.guildId) !== session.guildId) return;
      if (isComponent && !opensModal(interaction.customId) && !interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate().catch(() => {});
      }
      await session.handle(interaction);
    } catch {}
  });
}

module.exports.ensureGlobalSetupListener = ensureGlobalSetupListener;
module.exports.data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Configurer PROSYNC : salons, rôles, IDs et automations.')
  .setDefaultMemberPermissions(0n);

module.exports.execute = async function execute(interaction) {
  if (!interaction.inGuild()) return interaction.reply({ content: '⛔', flags: MessageFlags.Ephemeral });
  ensureGlobalSetupListener(interaction.client);

  const saved = getGuildConfig(interaction.guildId) || {};
  if (!isStaff(interaction.member, saved)) {
    return interaction.reply({ content: '⛔ Accès réservé au STAFF.', flags: MessageFlags.Ephemeral });
  }

  const savedWarning = saved.automations?.avertissement || {};
  const draft = {
    disposChannelId: saved.disposChannelId || null,
    staffReportsChannelId: saved.staffReportsChannelId || null,
    pseudoScanChannelId: saved.pseudoScanChannelId || null,
    checkDispoChannelId: saved.checkDispoChannelId || null,
    dispoMessageIds: normalizeMessageIds(saved.dispoMessageIds),
    staffRoleIds: uniqIds(saved.staffRoleIds || (saved.staffRoleId ? [saved.staffRoleId] : [])),
    playerRoleIds: uniqIds(saved.playerRoleIds),
    postRoleIds: uniqIds(saved.postRoleIds || (saved.posts || []).map((post) => post?.roleId)),
    automations: {
      enabled: Boolean(saved.automations?.enabled),
      pseudo: {
        enabled: saved.automations?.pseudo?.enabled !== false,
        minute: clampMinute(saved.automations?.pseudo?.minute),
      },
      checkDispo: {
        enabled: Boolean(saved.automations?.checkDispo?.enabled),
        times: normalizeTimes(saved.automations?.checkDispo?.times),
      },
      rappel: {
        enabled: Boolean(saved.automations?.rappel?.enabled),
        times: normalizeTimes(saved.automations?.rappel?.times),
      },
      avertissement: {
        enabled: Boolean(savedWarning.enabled),
        roleIds: normalizeWarningRoleIds(
          Array.isArray(savedWarning.roleIds) ? savedWarning.roleIds : [savedWarning.roleId, null, null]
        ),
        lastProcessedDate: savedWarning.lastProcessedDate || null,
      },
    },
  };

  const scope = `${interaction.guildId}:${interaction.user.id}`;
  const old = SESSIONS.get(scope);
  if (old) await old.end().catch(() => {});

  const CID = {};
  for (const [key, prefix] of Object.entries({
    page: 'page', dispos: 'ch:dispos', staffReports: 'ch:staff', pseudoScan: 'ch:pseudo', checkDispo: 'ch:check',
    staff: 'role:staff', players: 'role:players', posts: 'role:posts', warning1: 'role:warning1', warning2: 'role:warning2', warning3: 'role:warning3',
    idsA: 'btn:idsA', idsB: 'btn:idsB', idsClear: 'btn:idsClear', idsAModal: 'modal:idsA', idsBModal: 'modal:idsB',
    autoTab: 'auto:tab', autoGlobal: 'btn:autoGlobal', autoPseudo: 'btn:autoPseudo', autoCheck: 'btn:autoCheck', autoRappel: 'btn:autoRappel', autoWarning: 'btn:autoWarning',
    minuteButton: 'btn:openMinute', minuteModal: 'modal:minute', checkTimes: 'sel:checkTimes', rappelTimes: 'sel:rappelTimes', clear: 'btn:clearCurrent',
    save: 'btn:confirmSave', saveModal: 'modal:confirmSave', reset: 'btn:reset', cancel: 'btn:cancel', preview: 'btn:preview',
  })) CID[key] = `setup:${prefix}:${scope}`;

  let page = 'Salons';
  let autoTab = 'check';
  let dirty = false;
  let ended = false;

  function pageRows() {
    const rows = [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(CID.page).setMinValues(1).setMaxValues(1).addOptions(
          { label: 'Salons', value: 'Salons', default: page === 'Salons' },
          { label: 'Rôles', value: 'Rôles', default: page === 'Rôles' },
          { label: 'CheckDispo / IDs', value: 'IDs', default: page === 'IDs' },
          { label: 'Automations', value: 'Automations', default: page === 'Automations' }
        )
      ),
    ];

    if (page === 'Salons') {
      rows.push(
        new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(CID.dispos).setPlaceholder('📅 Salon Dispos').setMinValues(0).setMaxValues(1).addChannelTypes(ChannelType.GuildText)),
        new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(CID.staffReports).setPlaceholder('📊 Salon Rapports Staff').setMinValues(0).setMaxValues(1).addChannelTypes(ChannelType.GuildText)),
        new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(CID.pseudoScan).setPlaceholder('🎮 Salon Pseudos').setMinValues(0).setMaxValues(1).addChannelTypes(ChannelType.GuildText))
      );
    } else if (page === 'Rôles') {
      rows.push(
        new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(CID.staff).setPlaceholder('🛡️ Rôles Staff').setMinValues(0).setMaxValues(25)),
        new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(CID.players).setPlaceholder('👟 Rôles Joueurs').setMinValues(0).setMaxValues(25)),
        new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(CID.posts).setPlaceholder('📌 Rôles Postes').setMinValues(0).setMaxValues(25))
      );
    } else if (page === 'IDs') {
      rows.push(
        new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(CID.checkDispo).setPlaceholder('🗓️ Salon Check Dispo').setMinValues(0).setMaxValues(1).addChannelTypes(ChannelType.GuildText)),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(CID.idsA).setLabel('IDs Lun → Ven').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(CID.idsB).setLabel('IDs Sam → Dim').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(CID.idsClear).setLabel('Effacer les IDs').setStyle(ButtonStyle.Secondary)
        )
      );
    } else {
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(CID.autoGlobal).setLabel('Global').setStyle(draft.automations.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(CID.autoPseudo).setLabel('Pseudo').setStyle(draft.automations.pseudo.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(CID.autoCheck).setLabel('Check').setStyle(draft.automations.checkDispo.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(CID.autoRappel).setLabel('Rappel').setStyle(draft.automations.rappel.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(CID.autoWarning).setLabel('Avertissement').setStyle(draft.automations.avertissement.enabled ? ButtonStyle.Danger : ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId(CID.autoTab).setMinValues(1).setMaxValues(1).addOptions(
            { label: 'Horaires CheckDispo', value: 'check', default: autoTab === 'check' },
            { label: 'Horaires Rappel', value: 'rappel', default: autoTab === 'rappel' },
            { label: 'Avertissement 1', value: 'warning1', default: autoTab === 'warning1' },
            { label: 'Avertissement 2', value: 'warning2', default: autoTab === 'warning2' },
            { label: 'Avertissement 3', value: 'warning3', default: autoTab === 'warning3' }
          )
        )
      );

      if (autoTab === 'check' || autoTab === 'rappel') {
        const values = autoTab === 'check' ? draft.automations.checkDispo.times : draft.automations.rappel.times;
        rows.push(new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(autoTab === 'check' ? CID.checkTimes : CID.rappelTimes)
            .setMinValues(0).setMaxValues(12)
            .addOptions(PRESET_TIMES.map((time) => ({ label: time, value: time, default: values.includes(time) })))
        ));
      } else {
        const index = Number(autoTab.at(-1)) - 1;
        rows.push(new ActionRowBuilder().addComponents(
          new RoleSelectMenuBuilder().setCustomId([CID.warning1, CID.warning2, CID.warning3][index]).setPlaceholder(`Rôle Avertissement ${index + 1}`).setMinValues(0).setMaxValues(1)
        ));
      }
    }

    const actionRow = new ActionRowBuilder().addComponents(
      ...(page === 'Automations' ? [new ButtonBuilder().setCustomId(CID.minuteButton).setLabel('⏱️ Minute').setStyle(ButtonStyle.Primary)] : [new ButtonBuilder().setCustomId(CID.preview).setLabel('Aperçu').setStyle(ButtonStyle.Secondary)]),
      new ButtonBuilder().setCustomId(CID.clear).setLabel('Effacer').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(CID.save).setLabel('Sauvegarder').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(CID.reset).setLabel('Reset').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(CID.cancel).setLabel('Annuler').setStyle(ButtonStyle.Danger)
    );
    rows.push(actionRow);

    for (const row of rows) {
      const component = row.components?.[0];
      if (component instanceof ChannelSelectMenuBuilder) {
        const map = { [CID.dispos]: draft.disposChannelId, [CID.staffReports]: draft.staffReportsChannelId, [CID.pseudoScan]: draft.pseudoScanChannelId, [CID.checkDispo]: draft.checkDispoChannelId };
        if (Object.prototype.hasOwnProperty.call(map, component.data.custom_id)) component.setDefaultChannels(map[component.data.custom_id] ? [map[component.data.custom_id]] : []);
      }
      if (component instanceof RoleSelectMenuBuilder) {
        const map = { [CID.staff]: draft.staffRoleIds, [CID.players]: draft.playerRoleIds, [CID.posts]: draft.postRoleIds, [CID.warning1]: [draft.automations.avertissement.roleIds[0]].filter(Boolean), [CID.warning2]: [draft.automations.avertissement.roleIds[1]].filter(Boolean), [CID.warning3]: [draft.automations.avertissement.roleIds[2]].filter(Boolean) };
        if (map[component.data.custom_id]) component.setDefaultRoles(map[component.data.custom_id]);
      }
    }

    return rows;
  }

  async function refresh() {
    await interaction.editReply({ embeds: [buildEmbed(interaction.guild, draft, page, dirty)], components: pageRows() }).catch(() => {});
  }

  async function end() {
    if (ended) return;
    ended = true;
    SESSIONS.delete(scope);
    await interaction.editReply({ embeds: [buildEmbed(interaction.guild, draft, page, dirty)], components: [] }).catch(() => {});
  }

  async function handle(i) {
    if (i.isModalSubmit?.()) {
      if (i.customId === CID.minuteModal) {
        draft.automations.pseudo.minute = clampMinute(i.fields.getTextInputValue('minute'));
        dirty = true;
        await i.reply({ content: '✅ Minute mise à jour.', flags: MessageFlags.Ephemeral });
        return refresh();
      }
      if (i.customId === CID.idsAModal || i.customId === CID.idsBModal) {
        const days = i.customId === CID.idsAModal ? ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'] : ['Sam', 'Dim'];
        for (const day of days) {
          const raw = String(i.fields.getTextInputValue(day) || '').trim();
          draft.dispoMessageIds[DAY_INDEX[day]] = isSnowflake(raw) ? raw : null;
        }
        dirty = true;
        await i.reply({ content: '✅ IDs mis à jour.', flags: MessageFlags.Ephemeral });
        return refresh();
      }
      if (i.customId === CID.saveModal) {
        if (String(i.fields.getTextInputValue('confirm') || '').trim().toUpperCase() !== 'CONFIRMER') {
          return i.reply({ content: '⚠️ Tape exactement CONFIRMER.', flags: MessageFlags.Ephemeral });
        }
        const warningIds = normalizeWarningRoleIds(draft.automations.avertissement.roleIds);
        if (!draft.disposChannelId || !draft.staffReportsChannelId || !draft.staffRoleIds.length || !draft.playerRoleIds.length) {
          return i.reply({ content: '⚠️ Setup incomplet.', flags: MessageFlags.Ephemeral });
        }
        if (draft.automations.avertissement.enabled && !warningIds[0]) {
          return i.reply({ content: '⚠️ Configure au minimum Avertissement 1.', flags: MessageFlags.Ephemeral });
        }
        if ((warningIds[2] && !warningIds[1]) || (warningIds[1] && !warningIds[0])) {
          return i.reply({ content: '⚠️ Configure les rôles dans l’ordre 1, 2, 3.', flags: MessageFlags.Ephemeral });
        }
        if (draft.automations.avertissement.enabled && !draft.automations.checkDispo.times.length) {
          return i.reply({ content: '⚠️ Configure au moins un horaire CheckDispo.', flags: MessageFlags.Ephemeral });
        }

        upsertGuildConfig(interaction.guildId, {
          botLabel: 'PROSYNC',
          disposChannelId: draft.disposChannelId,
          staffReportsChannelId: draft.staffReportsChannelId,
          pseudoScanChannelId: draft.pseudoScanChannelId,
          checkDispoChannelId: draft.checkDispoChannelId,
          dispoMessageIds: draft.dispoMessageIds,
          staffRoleIds: draft.staffRoleIds,
          playerRoleIds: draft.playerRoleIds,
          postRoleIds: draft.postRoleIds,
          staffRoleId: draft.staffRoleIds[0] || null,
          posts: draft.postRoleIds.map((roleId) => ({ roleId, label: 'POSTE' })),
          automations: {
            enabled: draft.automations.enabled,
            pseudo: draft.automations.pseudo,
            checkDispo: draft.automations.checkDispo,
            rappel: draft.automations.rappel,
            avertissement: {
              enabled: draft.automations.avertissement.enabled,
              roleIds: warningIds,
              roleId: warningIds[0] || null,
              lastProcessedDate: draft.automations.avertissement.lastProcessedDate,
            },
          },
          setupBy: interaction.user.id,
          setupAt: new Date().toISOString(),
        });
        dirty = false;
        await i.reply({ content: '💾 Configuration PROSYNC sauvegardée.', flags: MessageFlags.Ephemeral });
        return end();
      }
      return;
    }

    if (i.isStringSelectMenu?.()) {
      if (i.customId === CID.page) page = i.values[0];
      else if (i.customId === CID.autoTab) autoTab = i.values[0];
      else if (i.customId === CID.checkTimes) { draft.automations.checkDispo.times = normalizeTimes(i.values); dirty = true; }
      else if (i.customId === CID.rappelTimes) { draft.automations.rappel.times = normalizeTimes(i.values); dirty = true; }
      return refresh();
    }

    if (i.isChannelSelectMenu?.()) {
      const value = i.values[0] || null;
      if (i.customId === CID.dispos) draft.disposChannelId = value;
      if (i.customId === CID.staffReports) draft.staffReportsChannelId = value;
      if (i.customId === CID.pseudoScan) draft.pseudoScanChannelId = value;
      if (i.customId === CID.checkDispo) draft.checkDispoChannelId = value;
      dirty = true;
      return refresh();
    }

    if (i.isRoleSelectMenu?.()) {
      if (i.customId === CID.staff) draft.staffRoleIds = uniqIds(i.values);
      if (i.customId === CID.players) draft.playerRoleIds = uniqIds(i.values);
      if (i.customId === CID.posts) draft.postRoleIds = uniqIds(i.values);
      const warningIndex = i.customId === CID.warning1 ? 0 : i.customId === CID.warning2 ? 1 : i.customId === CID.warning3 ? 2 : -1;
      if (warningIndex >= 0) {
        draft.automations.avertissement.roleIds[warningIndex] = i.values[0] || null;
        draft.automations.avertissement.roleIds = normalizeWarningRoleIds(draft.automations.avertissement.roleIds);
      }
      dirty = true;
      return refresh();
    }

    if (!i.isButton?.()) return;
    if (i.customId === CID.save) return i.showModal(confirmModal(CID.saveModal));
    if (i.customId === CID.minuteButton) return i.showModal(minuteModal(CID.minuteModal, draft.automations.pseudo.minute));
    if (i.customId === CID.idsA) return i.showModal(idsModal(CID.idsAModal, ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'], draft.dispoMessageIds, 'IDs Lundi à Vendredi'));
    if (i.customId === CID.idsB) return i.showModal(idsModal(CID.idsBModal, ['Sam', 'Dim'], draft.dispoMessageIds, 'IDs Samedi et Dimanche'));
    if (i.customId === CID.cancel) return end();
    if (i.customId === CID.preview) return refresh();
    if (i.customId === CID.idsClear) { draft.dispoMessageIds = new Array(7).fill(null); dirty = true; return refresh(); }
    if (i.customId === CID.autoGlobal) draft.automations.enabled = !draft.automations.enabled;
    if (i.customId === CID.autoPseudo) draft.automations.pseudo.enabled = !draft.automations.pseudo.enabled;
    if (i.customId === CID.autoCheck) draft.automations.checkDispo.enabled = !draft.automations.checkDispo.enabled;
    if (i.customId === CID.autoRappel) draft.automations.rappel.enabled = !draft.automations.rappel.enabled;
    if (i.customId === CID.autoWarning) draft.automations.avertissement.enabled = !draft.automations.avertissement.enabled;
    if (i.customId === CID.clear) {
      if (page === 'Automations' && autoTab === 'check') draft.automations.checkDispo.times = [];
      else if (page === 'Automations' && autoTab === 'rappel') draft.automations.rappel.times = [];
      else if (page === 'Automations' && autoTab.startsWith('warning')) draft.automations.avertissement.roleIds[Number(autoTab.at(-1)) - 1] = null;
    }
    if (i.customId === CID.reset) {
      Object.assign(draft, {
        disposChannelId: null, staffReportsChannelId: null, pseudoScanChannelId: null, checkDispoChannelId: null,
        dispoMessageIds: new Array(7).fill(null), staffRoleIds: [], playerRoleIds: [], postRoleIds: [],
        automations: { enabled: false, pseudo: { enabled: true, minute: 10 }, checkDispo: { enabled: false, times: [] }, rappel: { enabled: false, times: [] }, avertissement: { enabled: false, roleIds: [null, null, null], lastProcessedDate: null } },
      });
    }
    dirty = true;
    return refresh();
  }

  await interaction.reply({ embeds: [buildEmbed(interaction.guild, draft, page, dirty)], components: pageRows(), flags: MessageFlags.Ephemeral });
  SESSIONS.set(scope, { guildId: interaction.guildId, userId: interaction.user.id, handle, end });
  const timer = setTimeout(() => end().catch(() => {}), 10 * 60 * 1000);
  timer.unref?.();
};
