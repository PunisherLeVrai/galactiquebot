// commands/annonce.js
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

/* ---------- Couleur par serveur ---------- */
function getEmbedColorFromCfg(guildCfg) {
  const hex = guildCfg?.embedColor;
  if (!hex) return DEFAULT_COLOR;

  const clean = String(hex).replace(/^0x/i, '').replace('#', '');
  const num = parseInt(clean, 16);
  return Number.isNaN(num) ? DEFAULT_COLOR : num;
}

/* ---------- Helpers sécurité / format ---------- */
function sanitize(text) {
  return String(text || '')
    .replace(/^["“”]|["“”]$/g, '')
    .replace(/@everyone|@here|<@&\d+>/g, '[mention bloquée 🚫]')
    .trim();
}

function buildMention(mention, role) {
  if (mention === 'everyone') return '@everyone';
  if (mention === 'here') return '@here';
  if (mention === 'role' && role) return `<@&${role.id}>`;
  return '';
}

function getAllowedMentionsForHeader(mentionType, role) {
  if (mentionType === 'everyone') return { parse: ['everyone'] };
  if (mentionType === 'here') return { parse: ['here'] };
  if (mentionType === 'role' && role) return { roles: [role.id] };
  return { parse: [] };
}

function isValidHttpUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/* ---------- Message LOGE (compact + règlement compact) ---------- */
function buildLodgeMessage({ userId, clubName }) {
  // Texte compact comme tu voulais
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
        .setDescription('Texte principal de l’annonce (interne / communiqué)')
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
        .setDescription('Titre personnalisé de l’annonce')
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('mention')
        .setDescription('Mention à placer au-dessus du message')
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
        .setDescription('Image ou bannière à joindre (communiqué)')
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
    )
    .addStringOption(o =>
      o.setName('bouton_url')
        .setDescription('Lien ouvert par le bouton (communiqué)')
        .setRequired(false)
    )

    .addBooleanOption(o =>
      o.setName('reactions')
        .setDescription('Ajouter ✅❌ sous le communiqué')
        .setRequired(false)
    )

    .addStringOption(o =>
      o.setName('message')
        .setDescription('Texte additionnel ou mot du staff (signature)')
        .setRequired(false)
    )
    .addBooleanOption(o =>
      o.setName('changer_roles')
        .setDescription('Retirer Essai → ajouter Joueur automatiquement (signature). Défaut : oui')
        .setRequired(false)
    )
    .addRoleOption(o =>
      o.setName('role_joueur')
        .setDescription('Rôle Joueur à ajouter (signature)')
        .setRequired(false)
    )
    .addRoleOption(o =>
      o.setName('role_essai')
        .setDescription('Rôle Essai à retirer (signature)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const type = interaction.options.getString('type', true);

    const globalCfg = getGlobalConfig() || {};
    const { guild: guildCfg } = getConfigFromInteraction(interaction) || {};

    const clubName =
      guildCfg?.clubName ||
      interaction.guild?.name ||
      globalCfg.botName ||
      'INTER GALACTIQUE';

    const color = getEmbedColorFromCfg(guildCfg);

    const salon = interaction.options.getChannel('salon') || interaction.channel;
    if (!salon || !salon.isTextBased()) {
      return interaction.reply({
        content: '❌ Salon cible introuvable ou non textuel.',
        ephemeral: true
      });
    }

    const mentionType = interaction.options.getString('mention') || 'none';
    const role = interaction.options.getRole('role') || null;

    if (mentionType === 'role' && !role) {
      return interaction.reply({
        content: '❌ Tu as choisi **Un rôle** à mentionner, mais aucun `role` n’a été fourni.',
        ephemeral: true
      });
    }

    await interaction.reply({ content: '🛰️ Préparation de l’annonce…', ephemeral: true });

    const mentionLine = buildMention(mentionType, role);
    const allowedMentionHeader = getAllowedMentionsForHeader(mentionType, role);

    /* =========================
       MODE LOGE OFFICIELLE (avec validation)
       ========================= */
    if (type === 'loge') {
      const user = interaction.options.getUser('joueur');
      if (!user) return interaction.editReply('❌ Tu dois préciser un `joueur` pour le mode **loge**.');

      const msg = buildLodgeMessage({ userId: user.id, clubName });

      // ✅ Bouton validation unique pour ce joueur
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`loge_accept:${interaction.guild.id}:${user.id}`)
          .setLabel('✅ J’ai lu et j’accepte le règlement')
          .setStyle(ButtonStyle.Success)
      );

      try {
        if (mentionLine) await salon.send({ content: mentionLine, allowedMentions: allowedMentionHeader });

        await salon.send({
          content: msg,
          components: [row],
          allowedMentions: { users: [user.id], parse: [] }
        });

        return interaction.editReply(`✅ Entrée en loge envoyée dans <#${salon.id}> (validation requise).`);
      } catch (e) {
        console.error('Erreur envoi annonce loge :', e);
        return interaction.editReply('❌ Impossible d’envoyer le message (permissions ?).');
      }
    }

    /* =========================
       MODE SIGNATURE OFFICIELLE
       ========================= */
    if (type === 'signature') {
      const user = interaction.options.getUser('joueur');
      if (!user) return interaction.editReply('❌ Tu dois préciser un `joueur` pour le mode **signature**.');

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
        if (mentionLine) await salon.send({ content: mentionLine, allowedMentions: allowedMentionHeader });
        await salon.send({ embeds: [embed], allowedMentions: { users: [user.id] } });
      } catch (err) {
        console.error('Erreur envoi annonce signature :', err);
        return interaction.editReply('❌ Impossible d’envoyer l’annonce (permissions ?).');
      }

      let rolesLog = '—';
      if (!changerRoles) {
        rolesLog = '⏭️ Changement de rôles désactivé.';
        return interaction.editReply(`✅ Signature annoncée dans <#${salon.id}>.\n🧩 Rôles : ${rolesLog}`);
      }

      if (!roleJoueurId && !roleEssaiId) {
        rolesLog = '⚠️ Aucun rôle Joueur/Essai défini (ni commande, ni servers.json).';
        return interaction.editReply(`✅ Signature annoncée dans <#${salon.id}>.\n🧩 Rôles : ${rolesLog}`);
      }

      try {
        const membre = await interaction.guild.members.fetch(user.id);
        const me = interaction.guild.members.me;

        if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
          rolesLog = '⚠️ Permission **Gérer les rôles** manquante.';
        } else {
          const roleJoueurObj = roleJoueurId ? interaction.guild.roles.cache.get(roleJoueurId) : null;
          const roleEssaiObj = roleEssaiId ? interaction.guild.roles.cache.get(roleEssaiId) : null;

          const canTouch =
            (!roleJoueurObj || me.roles.highest.position > roleJoueurObj.position) &&
            (!roleEssaiObj || me.roles.highest.position > roleEssaiObj.position);

          if (!canTouch) {
            rolesLog = '⚠️ Hiérarchie: mon rôle doit être au-dessus des rôles à gérer.';
          } else {
            if (roleEssaiObj && membre.roles.cache.has(roleEssaiObj.id)) {
              await membre.roles.remove(roleEssaiObj, 'Signature officielle — retrait Essai');
            }
            if (roleJoueurObj && !membre.roles.cache.has(roleJoueurObj.id)) {
              await membre.roles.add(roleJoueurObj, 'Signature officielle — ajout Joueur');
            }
            rolesLog = '✅ Rôles mis à jour (Essai → Joueur).';
          }
        }
      } catch (e) {
        console.error('Erreur mise à jour rôles :', e);
        rolesLog = '❌ Échec de mise à jour des rôles.';
      }

      return interaction.editReply(
        `✅ Signature annoncée dans <#${salon.id}> pour <@${user.id}>.\n🧩 Rôles : ${rolesLog}`
      );
    }

    // À partir d’ici : uniquement "interne" et "communique"
    const rawContenu = interaction.options.getString('contenu');
    if (!rawContenu) return interaction.editReply('❌ Tu dois renseigner `contenu` pour ce type d’annonce.');

    const contenu = sanitize(rawContenu);
    const titre =
      sanitize(interaction.options.getString('titre')) ||
      (type === 'communique' ? '✦ COMMUNIQUÉ OFFICIEL ✦' : '🗞️ ANNONCE INTERNE');

    /* ======================
       MODE ANNONCE INTERNE
       ====================== */
    if (type === 'interne') {
      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(titre)
        .setDescription(contenu)
        .setFooter({ text: `${clubName} ⚫ Communication interne` })
        .setTimestamp();

      try {
        if (mentionLine) await salon.send({ content: mentionLine, allowedMentions: allowedMentionHeader });
        await salon.send({ embeds: [embed], allowedMentions: { parse: [] } });
        return interaction.editReply(`✅ Annonce interne publiée dans <#${salon.id}>.`);
      } catch (e) {
        console.error('Erreur envoi annonce interne :', e);
        return interaction.editReply('❌ Impossible de publier l’annonce (permissions ?).');
      }
    }

    /* ======================
       MODE COMMUNIQUÉ OFFICIEL
       ====================== */
    if (type === 'communique') {
      const imageFile = interaction.options.getAttachment('image_fichier') || null;
      const imageUrl = interaction.options.getString('image_url') || null;
      const boutonLibelle = sanitize(interaction.options.getString('bouton_libelle') || '');
      const boutonURL = interaction.options.getString('bouton_url') || null;
      const addReactions = interaction.options.getBoolean('reactions') ?? false;

      if ((boutonLibelle && !boutonURL) || (!boutonLibelle && boutonURL)) {
        return interaction.editReply('❌ Pour ajouter un bouton, renseigne **libellé + URL**.');
      }
      if (boutonURL && !isValidHttpUrl(boutonURL)) {
        return interaction.editReply('❌ `bouton_url` doit être une URL http/https valide.');
      }
      if (imageUrl && !isValidHttpUrl(imageUrl)) {
        return interaction.editReply('❌ `image_url` doit être une URL http/https valide.');
      }

      const subtitle = `🛰️ Équipe **${clubName}** — *Annonce importante*`;

      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(titre)
        .setDescription([subtitle, '', contenu].join('\n'))
        .setFooter({ text: `${clubName} ⚫ Communiqué officiel` })
        .setTimestamp();

      if (imageFile) embed.setImage(imageFile.url);
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
        if (mentionLine) await salon.send({ content: mentionLine, allowedMentions: allowedMentionHeader });

        const sent = await salon.send({
          embeds: [embed],
          components,
          allowedMentions: { parse: [] }
        });

        if (addReactions) {
          await sent.react('✅').catch(() => {});
          await sent.react('❌').catch(() => {});
        }

        return interaction.editReply(`✅ Communiqué publié dans <#${salon.id}>.`);
      } catch (e) {
        console.error('Erreur envoi communiqué :', e);
        return interaction.editReply('❌ Impossible de publier le communiqué (permissions ?).');
      }
    }

    return interaction.editReply('❌ Type d’annonce inconnu.');
  }
};
