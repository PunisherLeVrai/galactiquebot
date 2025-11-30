// commands/disponibilites.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  AttachmentBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const { getConfigFromInteraction } = require('../utils/config');

const VERSION = 'disponibilites v3.3 FR+snapshot+verrouiller (config couleur+club)';
const RAPPORTS_DIR = path.join(__dirname, '../rapports');
const DEFAULT_COLOR = 0xff4db8;

// 🧹 Anti-mentions accidentelles dans les textes
const sanitize = (t) =>
  String(t || '').replace(/@everyone|@here|<@&\d+>/g, '[mention bloquée 🚫]');

// Couleur dynamique depuis la config
function getEmbedColor(cfg) {
  const hex = cfg?.embedColor;
  if (!hex) return DEFAULT_COLOR;
  const clean = String(hex).replace(/^0x/i, '').replace('#', '');
  const num = parseInt(clean, 16);
  return Number.isNaN(num) ? DEFAULT_COLOR : num;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('disponibilites')
    .setDescription('Rapport, rappel, snapshot ou fermeture des disponibilités du jour.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    // ⚠️ Tous les options REQUIRED en premier (règle Discord)
    // 📅 Jour
    .addStringOption(o =>
      o.setName('jour')
        .setDescription('Jour à vérifier')
        .setRequired(true)
        .addChoices(
          { name: 'Lundi', value: 'lundi' },
          { name: 'Mardi', value: 'mardi' },
          { name: 'Mercredi', value: 'mercredi' },
          { name: 'Jeudi', value: 'jeudi' },
          { name: 'Vendredi', value: 'vendredi' },
          { name: 'Samedi', value: 'samedi' },
          { name: 'Dimanche', value: 'dimanche' }
        )
    )

    // 🎛 Mode
    .addStringOption(o =>
      o.setName('mode')
        .setDescription('Type de sortie à générer')
        .setRequired(true)
        .addChoices(
          { name: 'Embed simple (non-répondants)', value: 'embed_simple' },
          { name: 'Embed détaillé (✅ / ❌ / ⏳)', value: 'embed_detaille' },
          { name: 'Rappel aux absents (mentions)', value: 'rappel_absents' },
          { name: 'Snapshot (JSON + .txt)', value: 'snapshot' },
          { name: 'Verrouiller + snapshot', value: 'verrouiller' }
        )
    )

    // 🧵 Salon contenant le message de disponibilités (obligatoire)
    .addChannelOption(o =>
      o.setName('salon_dispos')
        .setDescription('Salon où se trouve le message de disponibilités du jour')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )

    // 🆔 ID du message de disponibilités (obligatoire)
    .addStringOption(o =>
      o.setName('message_id')
        .setDescription('ID du message de disponibilités du jour (clic droit → Copier l’identifiant)')
        .setRequired(true)
    )

    // ========== À partir d’ici : options facultatives ==========
    // 🧵 Salon des rapports / rappels (optionnel)
    .addChannelOption(o =>
      o.setName('salon')
        .setDescription('Salon où envoyer le rapport/rappel (défaut : salon des rapports ou salon courant)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )

    // 🏷️ Rôle Joueur (optionnel)
    .addRoleOption(o =>
      o.setName('role_joueur')
        .setDescription('Rôle des joueurs officiels pris en compte pour le rapport')
        .setRequired(false)
    )

    // 🏷️ Rôle Essai (optionnel)
    .addRoleOption(o =>
      o.setName('role_essai')
        .setDescription('Rôle des joueurs en essai pris en compte pour le rapport')
        .setRequired(false)
    )

    // ⚙️ Options spécifiques au mode "verrouiller"
    .addBooleanOption(o =>
      o.setName('annoncer')
        .setDescription('Pour "verrouiller" : annoncer la fermeture dans le salon des dispos (défaut : oui).')
        .setRequired(false)
    )
    .addBooleanOption(o =>
      o.setName('envoyer_rapport')
        .setDescription('Pour "verrouiller" : envoyer le .txt dans le salon choisi (défaut : oui).')
        .setRequired(false)
    ),

  async execute(interaction) {
    const jour = interaction.options.getString('jour', true);
    const mode = interaction.options.getString('mode', true);
    const guild = interaction.guild;

    // 🔧 Config dynamique serveur
    const { guild: guildConfig } = getConfigFromInteraction(interaction) || {};
    const cfgRoles = guildConfig?.roles || {};
    const color = getEmbedColor(guildConfig);
    const clubName = guildConfig?.clubName || guild.name || 'INTER GALACTIQUE';

    const rapportChannelId =
      guildConfig?.channels?.rapport ||
      guildConfig?.rapportChannelId ||
      null;

    // Salon cible (rapport / rappel)
    const targetChannel =
      interaction.options.getChannel('salon') ||
      (rapportChannelId ? guild.channels.cache.get(rapportChannelId) : null) ||
      interaction.channel;

    const dispoChannel = interaction.options.getChannel('salon_dispos');
    const messageId = interaction.options.getString('message_id', true);

    // Rôles : option > config > null
    let roleJoueur =
      interaction.options.getRole('role_joueur') ||
      (cfgRoles.joueur ? guild.roles.cache.get(cfgRoles.joueur) : null);

    let roleEssai =
      interaction.options.getRole('role_essai') ||
      (cfgRoles.essai ? guild.roles.cache.get(cfgRoles.essai) : null);

    if (!dispoChannel) {
      return interaction.reply({
        content: '❌ Salon de disponibilités introuvable.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (!roleJoueur && !roleEssai) {
      return interaction.reply({
        content: '❌ Aucun rôle joueur/essai trouvé. Fournis `role_joueur` ou `role_essai`, ou configure-les via `/config roles`.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (!targetChannel) {
      return interaction.reply({
        content: '❌ Salon cible introuvable.',
        flags: MessageFlags.Ephemeral
      });
    }

    // ✅ Vérifie les permissions du bot
    const me = guild.members.me;
    const needed = ['ViewChannel', 'SendMessages'];
    if (!targetChannel.permissionsFor?.(me)?.has(needed)) {
      return interaction.reply({
        content: `❌ Je ne peux pas écrire dans ${targetChannel}.`,
        flags: MessageFlags.Ephemeral
      });
    }

    await guild.members.fetch().catch(() => {});

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // 🔎 Récupération du message de disponibilités
    let message;
    try {
      message = await dispoChannel.messages.fetch(messageId);
    } catch {
      return interaction.editReply({
        content: `❌ Message de disponibilités introuvable pour **${jour}** (vérifie l’ID et le salon).`
      });
    }

    const dispoChannelId = dispoChannel.id;

    // 🔗 Bouton vers le message du jour
    const messageURL = `https://discord.com/channels/${guild.id}/${dispoChannelId}/${messageId}`;
    const rowBtn = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Voir le message du jour')
        .setStyle(ButtonStyle.Link)
        .setURL(messageURL)
    );

    // 📊 Analyse des réactions
    const reacted = new Set();
    const yes = new Set(); // ✅
    const no = new Set();  // ❌

    for (const [, reaction] of message.reactions.cache) {
      if (!['✅', '❌'].includes(reaction.emoji.name)) continue;
      const users = await reaction.users.fetch().catch(() => null);
      if (!users) continue;
      users.forEach(u => {
        if (u.bot) return;
        reacted.add(u.id);
        if (reaction.emoji.name === '✅') yes.add(u.id);
        else no.add(u.id);
      });
    }

    // 🎯 Membres éligibles : Joueurs + Essais (selon rôles fournis / config)
    const eligibles = guild.members.cache.filter(m => {
      if (m.user.bot) return false;
      const hasJoueur = roleJoueur ? m.roles.cache.has(roleJoueur.id) : false;
      const hasEssai  = roleEssai  ? m.roles.cache.has(roleEssai.id)  : false;
      return hasJoueur || hasEssai;
    });

    const nonRepondus = eligibles.filter(m => !reacted.has(m.id));

    // 🔧 Fonctions utilitaires
    const tri = (col) => [...col.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
    const idsLine = (col) => col.size ? tri(col).map(m => `<@${m.id}>`).join(' - ') : '_Aucun_';

    /* --- 🔹 EMBED SIMPLE --- */
    if (mode === 'embed_simple') {
      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`📅 RAPPORT - ${jour.toUpperCase()}`)
        .setDescription(
          nonRepondus.size === 0
            ? '✅ **Tout le monde a réagi.**'
            : `**Membres n’ayant pas réagi (${nonRepondus.size}) :**\n${idsLine(nonRepondus)}`
        )
        .setFooter({ text: `${clubName} ⚫ Rapport automatisé` })
        .setTimestamp();

      await targetChannel.send({
        embeds: [embed],
        components: [rowBtn],
        allowedMentions: { parse: [] }
      });
      return interaction.editReply({
        content: `✅ (${VERSION}) Rapport **simple** envoyé → ${targetChannel}`
      });
    }

    /* --- 🔹 EMBED DÉTAILLÉ --- */
    if (mode === 'embed_detaille') {
      const presentsAll = guild.members.cache.filter(m => !m.user.bot && yes.has(m.id));
      const absentsAll  = guild.members.cache.filter(m => !m.user.bot && no.has(m.id));

      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`📅 RAPPORT - ${jour.toUpperCase()}`)
        .addFields(
          { name: `✅ Présents (${presentsAll.size})`, value: idsLine(presentsAll) },
          { name: `❌ Ont dit absent (${absentsAll.size})`, value: idsLine(absentsAll) },
          { name: `⏳ N’ont pas réagi (${nonRepondus.size})`, value: idsLine(nonRepondus) }
        )
        .setFooter({ text: `${clubName} ⚫ Rapport automatisé` })
        .setTimestamp();

      await targetChannel.send({
        embeds: [embed],
        components: [rowBtn],
        allowedMentions: { parse: [] }
      });
      return interaction.editReply({
        content: `✅ (${VERSION}) Rapport **détaillé** envoyé → ${targetChannel}`
      });
    }

    /* --- 🔹 RAPPEL AUX ABSENTS --- */
    if (mode === 'rappel_absents') {
      const absents = [...nonRepondus.values()];
      if (absents.length === 0) {
        return interaction.editReply({
          content: `✅ Tout le monde a réagi pour **${jour}** !`
        });
      }

      const header = [
        `📣 **Rappel aux absents (${jour.toUpperCase()})**`,
        'Merci de réagir aux disponibilités du jour ✅❌',
        `➡️ ${dispoChannel} — [Accéder au message du jour](${messageURL})`
      ].join('\n');

      const ids = absents.map(m => m.id);

      function splitByMessageLimit(allIds, headerText = '', sep = ' - ', limit = 1900) {
        const batches = [];
        let cur = [];
        let curLen = headerText.length;

        for (const id of allIds) {
          const mention = `<@${id}>`;
          const addLen = (cur.length ? sep.length : 0) + mention.length;
          if (curLen + addLen > limit) {
            batches.push(cur);
            cur = [id];
            curLen = headerText.length + mention.length;
          } else {
            cur.push(id);
            curLen += addLen;
          }
        }
        if (cur.length) batches.push(cur);
        return batches;
      }

      const batches = splitByMessageLimit(ids, header + '\n\n');

      try {
        const first = batches.shift();
        if (first && first.length) {
          await targetChannel.send({
            content: `${header}\n\n${first.map(id => `<@${id}>`).join(' - ')}`,
            allowedMentions: { users: first, parse: [] }
          });
        }

        for (const batch of batches) {
          await targetChannel.send({
            content: batch.map(id => `<@${id}>`).join(' - '),
            allowedMentions: { users: batch, parse: [] }
          });
        }
      } catch (e) {
        console.error('Erreur envoi rappel absents :', e);
        return interaction.editReply({
          content: '⚠️ Impossible d’envoyer le rappel.'
        });
      }

      return interaction.editReply({
        content: `✅ Rappel envoyé dans ${targetChannel} (${ids.length} membre(s)).`
      });
    }

    /* --- 🔹 SNAPSHOT (JSON + .txt, sans fermer) --- */
    if (mode === 'snapshot') {
      try {
        if (!fs.existsSync(RAPPORTS_DIR)) {
          fs.mkdirSync(RAPPORTS_DIR, { recursive: true });
        }
      } catch {
        // on tente quand même de continuer
      }

      const dateStr = new Date().toISOString().split('T')[0];

      const snapshot = {
        jour,
        date: dateStr,
        messageId,
        channelId: dispoChannelId,
        reacted: [...reacted],
        presents: [...yes],
        absents: [...no],
        eligibles: [...eligibles.keys()]
      };
      const snapPath = path.join(RAPPORTS_DIR, `snapshot-${jour}-${dateStr}.json`);
      try {
        fs.writeFileSync(snapPath, JSON.stringify(snapshot, null, 2), 'utf8');
      } catch (e) {
        console.error('Erreur écriture snapshot dispo :', e);
      }

      const header = `📅 RAPPORT - ${jour.toUpperCase()}\n`;
      const body = nonRepondus.size === 0
        ? '✅ Aucun absent détecté.'
        : `⏳ Personnes n’ayant pas réagi (${nonRepondus.size}) :\n${idsLine(nonRepondus)}`;
      const footerTxt = `\n\n⚫ ${clubName} | Snapshot ${dateStr}`;
      const txtContent = `${header}\n${body}${footerTxt}`;
      const txtPath = path.join(RAPPORTS_DIR, `rapport-${jour}-simple-${dateStr}.txt`);
      try {
        fs.writeFileSync(txtPath, txtContent.replace(/\r\n/g, '\n'), 'utf8');
      } catch (e) {
        console.error('Erreur écriture rapport .txt dispo :', e);
      }

      return interaction.editReply({
        content: `✅ Snapshot enregistré pour **${jour.toUpperCase()}** dans \`/rapports\` (JSON + .txt).`
      });
    }

    /* --- 🔹 VERROUILLER + SNAPSHOT --- */
    if (mode === 'verrouiller') {
      const annoncer = interaction.options.getBoolean('annoncer') ?? true;
      const envoyerRapport = interaction.options.getBoolean('envoyer_rapport') ?? true;

      try {
        if (!fs.existsSync(RAPPORTS_DIR)) {
          fs.mkdirSync(RAPPORTS_DIR, { recursive: true });
        }
      } catch {}

      const dateStr = new Date().toISOString().split('T')[0];

      // Snapshot JSON
      const snapshot = {
        jour,
        date: dateStr,
        messageId,
        channelId: dispoChannelId,
        reacted: [...reacted],
        presents: [...yes],
        absents: [...no],
        eligibles: [...eligibles.keys()]
      };
      const snapPath = path.join(RAPPORTS_DIR, `snapshot-${jour}-${dateStr}.json`);
      try {
        fs.writeFileSync(snapPath, JSON.stringify(snapshot, null, 2), 'utf8');
      } catch {}

      // Rapport texte
      const header = `📅 RAPPORT — ${jour.toUpperCase()}`;
      const body = nonRepondus.size === 0
        ? '✅ Aucun absent détecté.'
        : `⏳ Membres n’ayant pas réagi (${nonRepondus.size}) :\n${idsLine(nonRepondus)}`;
      const footerTxt = `\n\n⚫ ${clubName} | Snapshot ${dateStr}`;
      const rapportTexte = `${header}\n\n${body}${footerTxt}`;
      const txtPath = path.join(RAPPORTS_DIR, `rapport-${jour}-simple-${dateStr}.txt`);
      try {
        fs.writeFileSync(txtPath, rapportTexte.replace(/\r\n/g, '\n'), 'utf8');
      } catch {}

      const attachment = new AttachmentBuilder(txtPath, {
        name: `rapport-${jour}-simple-${dateStr}.txt`
      });

      // Mise à jour de l’embed du message de dispo (ajout "Disponibilités fermées")
      try {
        const exist = message.embeds?.[0];
        if (exist) {
          const e = EmbedBuilder.from(exist);
          const desc = sanitize(exist.description || '');
          const lockLine = '🔒 **Disponibilités fermées** – merci de ne plus réagir.';
          if (!desc.includes('Disponibilités fermées')) {
            e.setDescription([desc, '', lockLine].filter(Boolean).join('\n'));
            e.setFooter({ text: `${clubName} ⚫ Disponibilités (fermées)` });
            await message.edit({ content: '', embeds: [e] });
          }
        }
      } catch {
        // pas bloquant
      }

      // Message public dans le salon de dispo
      if (annoncer) {
        const msgURL = `https://discord.com/channels/${guild.id}/${dispoChannelId}/${messageId}`;
        try {
          await dispoChannel.send({
            content: sanitize(
              [
                `🔒 **Les disponibilités pour ${jour.toUpperCase()} sont désormais fermées.**`,
                'Merci de votre compréhension.',
                `➡️ [Voir le message du jour](${msgURL})`
              ].join('\n')
            ),
            allowedMentions: { parse: [] }
          });
        } catch {}
      }

      // Envoi du rapport dans le salon cible
      if (envoyerRapport && targetChannel) {
        try {
          await targetChannel.send({
            content: `🔒 Rapport de fermeture — **${jour.toUpperCase()}**`,
            files: [attachment],
            allowedMentions: { parse: [] }
          });
        } catch {}
      }

      return interaction.editReply({
        content: `✅ Fermeture effectuée pour **${jour.toUpperCase()}**. Snapshot et rapport sauvegardés dans \`/rapports\`${envoyerRapport ? ` et envoyés dans ${targetChannel}.` : '.'}`
      });
    }

    // 🚫 Sécurité
    return interaction.editReply({
      content: '❌ Mode inconnu.'
    });
  }
};
