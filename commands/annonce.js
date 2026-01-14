// commands/annonce.js
// ✅ Version optimisée, robuste et intuitive
// - 4 modes : interne / communique / loge / signature
// - Mentions sécurisées (aucun ping non voulu)
// - Validation LOGE via bouton (loge_accept:guildId:userId)
// - Signature : annonce + (optionnel) switch Essai -> Joueur
// - Communiqué : image (fichier ou url), bouton link, réactions ✅❌
// - Messages d’erreur clairs + validations strictes

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder
} = require('discord.js');

const { getConfigFromInteraction, getGlobalConfig } = require('../utils/config');

const DEFAULT_COLOR = 0xff4db8;

/* ===================== HELPERS (sécurité / config) ===================== */
function getEmbedColorFromCfg(guildCfg) {
  const hex = guildCfg?.embedColor;
  if (!hex) return DEFAULT_COLOR;

  const clean = String(hex).replace(/^0x/i, '').replace('#', '');
  const num = parseInt(clean, 16);
  return Number.isNaN(num) ? DEFAULT_COLOR : num;
}

// Bloque @everyone / @here / mentions rôles et users, sauf via allowedMentions contrôlé
function sanitize(text) {
  return String(text || '')
    .replace(/^["“”]|["“”]$/g, '')
    .replace(/@everyone|@here|<@&\d+>|<@!?(\d+)>/g, '[mention bloquée 🚫]')
    .trim();
}

function isValidHttpUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function buildMentionLine(mentionType, role) {
  if (mentionType === 'everyone') return '@everyone';
  if (mentionType === 'here') return '@here';
  if (mentionType === 'role' && role) return `<@&${role.id}>`;
  return '';
}

function getAllowedMentionsForHeader(mentionType, role) {
  if (mentionType === 'everyone') return { parse: ['everyone'] };
  if (mentionType === 'here') return { parse: ['here'] };
  if (mentionType === 'role' && role) return { roles: [role.id] };
  return { parse: [] };
}

function getClubName(interaction, guildCfg, globalCfg) {
  return (
    guildCfg?.clubName ||
    interaction.guild?.name ||
    globalCfg?.botName ||
    'INTER GALACTIQUE'
  );
}

function getTargetChannel(interaction) {
  const salon = interaction.options.getChannel('salon') || interaction.channel;
  if (!salon || !salon.isTextBased()) return null;
  return salon;
}

function canSendIn(channel, guild) {
  try {
    const me = guild.members.me;
    if (!me) return false;
    const needed = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages
    ];
    return channel.permissionsFor(me)?.has(needed) ?? false;
  } catch {
    return false;
  }
}

/* ===================== LOGE (message) ===================== */
function buildLodgeMessage({ userId, clubName }) {
  return [
    `## 🏟️・**BIENVENUE DANS L’EFFECTIF OFFICIEL**`,
    `👋 **Bonjour <@${userId}>**, bienvenue dans l’effectif officiel **${clubName}** 🌌`,
    `💬 Tu disposes d’une **LOGE PERSONNELLE** (canal privé staff) : **seul espace officiel** pour toute demande ou signalement.`,
    `⚠️ **Aucun MP staff ne sera pris en compte** — tout passe par ta loge.`,
    `📸 Photo/capture possible pour une **PP personnalisée**.`,
    `🎯 **Rigueur • Respect • Engagement** — **honore le maillot.**`,
    ``,
    `---`,
    ``,
    `## 🪐 RÈGLEMENT OFFICIEL — **XIG INTER GALACTIQUE**`,
    `> En restant sur ce serveur, tu acceptes ce règlement.`,
    ``,
    `• **Respect absolu**, zéro toxicité`,
    `• **Présence obligatoire** si dispo (prévenir ≥ 2h avant)`,
    `• **Dispos avant 17h** (✅ / ❌ obligatoire)`,
    `• **Compos dès 17h**, convoqué = validation obligatoire`,
    `• **Sessions 20h45 → 23h00**, prêt avant`,
    `• **Micro obligatoire**, décisions staff non discutables`,
    `• **Sanctions** : ⚠️ → ⛔ → 💀`,
    `• **Discord** : pas de spam, pseudo clair, MP ≠ salons`,
    ``,
    `🌌 **XIG INTER GALACTIQUE** = discipline • engagement • performance`,
    ``,
    `✅ **Validation obligatoire ci-dessous :**`
  ].join('\n');
}

/* ===================== ENVOI (header mention + payload) ===================== */
async function sendWithOptionalHeader({ channel, mentionLine, allowedMentionsHeader, payload }) {
  if (mentionLine) {
    await channel.send({
      content: mentionLine,
      allowedMentions: allowedMentionsHeader
    });
  }
  return channel.send(payload);
}

/* ===================== ROLES (signature) ===================== */
async function trySwitchRoles({ interaction, userId, roleEssaiId, roleJoueurId }) {
  const guild = interaction.guild;
  if (!guild) return { ok: false, reason: 'Guild introuvable.' };

  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return { ok: false, reason: 'Permission **Gérer les rôles** manquante.' };
  }

  let member;
  try {
    member = await guild.members.fetch(userId);
  } catch {
    return { ok: false, reason: 'Membre introuvable (a quitté le serveur ?).' };
  }

  const roleEssai = roleEssaiId ? guild.roles.cache.get(roleEssaiId) : null;
  const roleJoueur = roleJoueurId ? guild.roles.cache.get(roleJoueurId) : null;

  if (!roleEssai && !roleJoueur) {
    return { ok: false, reason: 'Aucun rôle Joueur/Essai valide trouvé.' };
  }

  // Hiérarchie : le bot doit être au-dessus des rôles à gérer
  const highest = me.roles.highest?.position ?? 0;
  if ((roleEssai && highest <= roleEssai.position) || (roleJoueur && highest <= roleJoueur.position)) {
    return { ok: false, reason: 'Hiérarchie : le rôle du bot doit être au-dessus des rôles à gérer.' };
  }

  try {
    if (roleEssai && member.roles.cache.has(roleEssai.id)) {
      await member.roles.remove(roleEssai, 'Signature officielle — retrait Essai');
    }
    if (roleJoueur && !member.roles.cache.has(roleJoueur.id)) {
      await member.roles.add(roleJoueur, 'Signature officielle — ajout Joueur');
    }
    return { ok: true, reason: '✅ Rôles mis à jour (Essai → Joueur).' };
  } catch (e) {
    console.error('Erreur switch roles:', e);
    return { ok: false, reason: '❌ Échec lors de la mise à jour des rôles.' };
  }
}

/* ===================== COMMAND ===================== */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('annonce')
    .setDescription('Annonce interne, communiqué, loge ou signature officielle.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addStringOption(o =>
      o.setName('type')
        .setDescription('Type d’annonce à envoyer')
        .setRequired(true)
        .addChoices(
          { name: 'Annonce interne', value: 'interne' },
          { name: 'Communiqué officiel', value: 'communique' },
          { name: 'Entrée dans la loge', value: 'loge' },
          { name: 'Signature officielle', value: 'signature' }
        )
    )

    .addUserOption(o =>
      o.setName('joueur')
        .setDescription('Joueur concerné (loge ou signature)')
        .setRequired(false)
    )

    .addStringOption(o =>
      o.setName('contenu')
        .setDescription('Texte principal (interne / communiqué)')
        .setRequired(false)
        .setMaxLength(1800)
    )

    .addChannelOption(o =>
      o.setName('salon')
        .setDescription('Salon où publier le message')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )

    .addStringOption(o =>
      o.setName('titre')
        .setDescription('Titre personnalisé')
        .setRequired(false)
        .setMaxLength(120)
    )

    .addStringOption(o =>
      o.setName('mention')
        .setDescription('Mention au-dessus du message')
        .setRequired(false)
        .addChoices(
          { name: 'Aucune', value: 'none' },
          { name: '@everyone', value: 'everyone' },
          { name: '@here', value: 'here' },
          { name: 'Un rôle', value: 'role' }
        )
    )
    .addRoleOption(o =>
      o.setName('role')
        .setDescription('Rôle à mentionner si "Un rôle" est choisi')
        .setRequired(false)
    )

    .addAttachmentOption(o =>
      o.setName('image_fichier')
        .setDescription('Image/bannière (communiqué)')
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('image_url')
        .setDescription('URL d’une image/bannière (communiqué)')
        .setRequired(false)
    )

    .addStringOption(o =>
      o.setName('bouton_libelle')
        .setDescription('Texte du bouton (communiqué)')
        .setRequired(false)
        .setMaxLength(80)
    )
    .addStringOption(o =>
      o.setName('bouton_url')
        .setDescription('Lien du bouton (communiqué)')
        .setRequired(false)
    )

    .addBooleanOption(o =>
      o.setName('reactions')
        .setDescription('Ajouter ✅❌ sous le communiqué')
        .setRequired(false)
    )

    .addStringOption(o =>
      o.setName('message')
        .setDescription('Mot du staff (signature)')
        .setRequired(false)
        .setMaxLength(400)
    )
    .addBooleanOption(o =>
      o.setName('changer_roles')
        .setDescription('Retirer Essai → ajouter Joueur (signature). Défaut : oui')
        .setRequired(false)
    )
    .addRoleOption(o =>
      o.setName('role_joueur')
        .setDescription('Rôle Joueur (signature)')
        .setRequired(false)
    )
    .addRoleOption(o =>
      o.setName('role_essai')
        .setDescription('Rôle Essai (signature)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const type = interaction.options.getString('type', true);

    const globalCfg = getGlobalConfig() || {};
    const { guild: guildCfg } = getConfigFromInteraction(interaction) || {};

    const clubName = getClubName(interaction, guildCfg, globalCfg);
    const color = getEmbedColorFromCfg(guildCfg);

    const channel = getTargetChannel(interaction);
    if (!channel) {
      return interaction.reply({ content: '❌ Salon cible introuvable ou non textuel.', ephemeral: true });
    }
    if (!canSendIn(channel, interaction.guild)) {
      return interaction.reply({ content: `❌ Je ne peux pas écrire dans <#${channel.id}> (permissions).`, ephemeral: true });
    }

    const mentionType = interaction.options.getString('mention') || 'none';
    const role = interaction.options.getRole('role') || null;
    if (mentionType === 'role' && !role) {
      return interaction.reply({ content: '❌ Mention "Un rôle" choisie, mais aucun rôle fourni.', ephemeral: true });
    }

    const mentionLine = buildMentionLine(mentionType, role);
    const allowedMentionsHeader = getAllowedMentionsForHeader(mentionType, role);

    await interaction.reply({ content: '🛰️ Préparation de l’annonce…', ephemeral: true });

    /* ========================= LOGE ========================= */
    if (type === 'loge') {
      const user = interaction.options.getUser('joueur');
      if (!user) return interaction.editReply('❌ Tu dois préciser `joueur` pour le mode **loge**.');

      const msg = buildLodgeMessage({ userId: user.id, clubName });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`loge_accept:${interaction.guild.id}:${user.id}`)
          .setLabel('✅ J’ai lu et j’accepte le règlement')
          .setStyle(ButtonStyle.Success)
      );

      try {
        await sendWithOptionalHeader({
          channel,
          mentionLine,
          allowedMentionsHeader,
          payload: {
            content: msg,
            components: [row],
            // On autorise UNIQUEMENT la mention du joueur dans le message de loge
            allowedMentions: { users: [user.id], parse: [] }
          }
        });

        return interaction.editReply(`✅ Entrée en loge envoyée dans <#${channel.id}> (validation requise).`);
      } catch (e) {
        console.error('Erreur annonce loge:', e);
        return interaction.editReply('❌ Impossible d’envoyer le message (permissions / erreur Discord).');
      }
    }

    /* ========================= SIGNATURE ========================= */
    if (type === 'signature') {
      const user = interaction.options.getUser('joueur');
      if (!user) return interaction.editReply('❌ Tu dois préciser `joueur` pour le mode **signature**.');

      const messagePerso = sanitize(interaction.options.getString('message') || '');
      const changerRoles = interaction.options.getBoolean('changer_roles') ?? true;

      const roleJoueurFromCmd = interaction.options.getRole('role_joueur') || null;
      const roleEssaiFromCmd = interaction.options.getRole('role_essai') || null;

      const roleJoueurId = roleJoueurFromCmd?.id || guildCfg?.roles?.joueur || null;
      const roleEssaiId = roleEssaiFromCmd?.id || guildCfg?.roles?.essai || null;

      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle('🖊️ Nouvelle signature officielle')
        .setDescription(
          [
            `> <@${user.id}> rejoint officiellement **${clubName}** !`,
            '',
            '🎉 Félicitations pour ta période d’essai réussie, tu fais désormais partie du groupe officiel.',
            messagePerso ? `\n💬 _${messagePerso}_` : ''
          ].join('\n')
        )
        .setFooter({ text: `${clubName} ⚫ Signature officielle` })
        .setTimestamp();

      try {
        await sendWithOptionalHeader({
          channel,
          mentionLine,
          allowedMentionsHeader,
          payload: {
            embeds: [embed],
            allowedMentions: { users: [user.id], parse: [] }
          }
        });
      } catch (e) {
        console.error('Erreur annonce signature:', e);
        return interaction.editReply('❌ Impossible d’envoyer l’annonce (permissions / erreur Discord).');
      }

      if (!changerRoles) {
        return interaction.editReply(`✅ Signature annoncée dans <#${channel.id}>.\n🧩 Rôles : ⏭️ Désactivé.`);
      }

      const result = await trySwitchRoles({
        interaction,
        userId: user.id,
        roleEssaiId,
        roleJoueurId
      });

      return interaction.editReply(
        `✅ Signature annoncée dans <#${channel.id}> pour <@${user.id}>.\n🧩 Rôles : ${result.reason}`
      );
    }

    /* ========================= INTERNE / COMMUNIQUE ========================= */
    const rawContenu = interaction.options.getString('contenu');
    if (!rawContenu) return interaction.editReply('❌ Tu dois renseigner `contenu` pour ce type d’annonce.');
    const contenu = sanitize(rawContenu);

    const titreCmd = sanitize(interaction.options.getString('titre') || '');
    const titre =
      titreCmd ||
      (type === 'communique' ? '✦ COMMUNIQUÉ OFFICIEL ✦' : '🗞️ ANNONCE INTERNE');

    /* ========================= INTERNE ========================= */
    if (type === 'interne') {
      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(titre)
        .setDescription(contenu)
        .setFooter({ text: `${clubName} ⚫ Communication interne` })
        .setTimestamp();

      try {
        await sendWithOptionalHeader({
          channel,
          mentionLine,
          allowedMentionsHeader,
          payload: {
            embeds: [embed],
            allowedMentions: { parse: [] }
          }
        });

        return interaction.editReply(`✅ Annonce interne publiée dans <#${channel.id}>.`);
      } catch (e) {
        console.error('Erreur annonce interne:', e);
        return interaction.editReply('❌ Impossible de publier l’annonce (permissions / erreur Discord).');
      }
    }

    /* ========================= COMMUNIQUE ========================= */
    if (type === 'communique') {
      const imageFile = interaction.options.getAttachment('image_fichier') || null;
      const imageUrl = interaction.options.getString('image_url') || null;

      const boutonLibelle = sanitize(interaction.options.getString('bouton_libelle') || '');
      const boutonURL = interaction.options.getString('bouton_url') || null;

      const addReactions = interaction.options.getBoolean('reactions') ?? false;

      // validations bouton
      if ((boutonLibelle && !boutonURL) || (!boutonLibelle && boutonURL)) {
        return interaction.editReply('❌ Pour ajouter un bouton, renseigne **bouton_libelle + bouton_url**.');
      }
      if (boutonURL && !isValidHttpUrl(boutonURL)) {
        return interaction.editReply('❌ `bouton_url` doit être une URL http/https valide.');
      }

      // validations image
      if (imageUrl && !isValidHttpUrl(imageUrl)) {
        return interaction.editReply('❌ `image_url` doit être une URL http/https valide.');
      }
      if (imageFile && imageUrl) {
        // On garde le fichier en priorité, mais on le dit clairement
        // (évite confusion côté user)
      }

      const subtitle = `🛰️ Équipe **${clubName}** — *Annonce importante*`;

      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(titre)
        .setDescription([subtitle, '', contenu].join('\n'))
        .setFooter({ text: `${clubName} ⚫ Communiqué officiel` })
        .setTimestamp();

      if (imageFile?.url) embed.setImage(imageFile.url);
      else if (imageUrl) embed.setImage(imageUrl);

      const components = [];
      if (boutonLibelle && boutonURL) {
        const btn = new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel(boutonLibelle)
          .setURL(boutonURL);

        components.push(new ActionRowBuilder().addComponents(btn));
      }

      try {
        const sent = await sendWithOptionalHeader({
          channel,
          mentionLine,
          allowedMentionsHeader,
          payload: {
            embeds: [embed],
            components,
            allowedMentions: { parse: [] }
          }
        });

        if (addReactions) {
          await sent.react('✅').catch(() => {});
          await sent.react('❌').catch(() => {});
        }

        return interaction.editReply(`✅ Communiqué publié dans <#${channel.id}>.`);
      } catch (e) {
        console.error('Erreur communiqué:', e);
        return interaction.editReply('❌ Impossible de publier le communiqué (permissions / erreur Discord).');
      }
    }

    return interaction.editReply('❌ Type d’annonce inconnu.');
  }
};
