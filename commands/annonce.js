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

const DEFAULT_COLOR = 0xff4db8; // rose par défaut

/* ---------- Couleur par serveur ---------- */
function getEmbedColorFromCfg(guildCfg) {
  const hex = guildCfg?.embedColor;
  if (!hex) return DEFAULT_COLOR;

  const clean = String(hex).replace(/^0x/i, '').replace('#', '');
  const num = parseInt(clean, 16);
  return Number.isNaN(num) ? DEFAULT_COLOR : num;
}

/* ---------- Helpers sécurité / format ---------- */

// Nettoie le texte (pas de massive mentions dans le contenu libre)
function sanitize(text) {
  return String(text || '')
    .replace(/^["“”]|["“”]$/g, '') // enlève guillemets d'encadrement
    .replace(/@everyone|@here|<@&\d+>/g, '[mention bloquée 🚫]')
    .trim();
}

// Construit la mention d’en-tête (facultative)
function buildMention(mention, role) {
  if (mention === 'everyone') return '@everyone';
  if (mention === 'here') return '@here';
  if (mention === 'role' && role) return `<@&${role.id}>`;
  return '';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('annonce')
    .setDescription('Annonce interne, communiqué, loge ou signature officielle.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    // 🔎 Type d’annonce
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

    // 👤 Joueur (utilisé pour "loge" et "signature")
    .addUserOption(o =>
      o.setName('joueur')
        .setDescription('Joueur concerné (loge ou signature)')
        .setRequired(false)
    )

    // 📝 Contenu principal (interne + communiqué)
    .addStringOption(o =>
      o.setName('contenu')
        .setDescription('Texte principal de l’annonce (interne / communiqué)')
        .setRequired(false)
        .setMaxLength(1800)
    )

    // 🎯 Cible
    .addChannelOption(o =>
      o.setName('salon')
        .setDescription('Salon où publier le message')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )

    // 🏷️ Présentation commune (interne + communiqué)
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

    // 🖼️ Options visuelles (uniquement pour "communique")
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

    // 🔗 Bouton (uniquement pour "communique")
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

    // ✅❌ Réactions (uniquement pour "communique")
    .addBooleanOption(o =>
      o.setName('reactions')
        .setDescription('Ajouter ✅❌ sous le communiqué')
        .setRequired(false)
    )

    // 💬 Options spécifiques pour "signature"
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
    // 🎭 Rôles gérés pour la signature (choisis à la main à chaque commande)
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

    // Récup config pour couleur + nom de club
    const globalCfg = getGlobalConfig() || {};
    const { guild: guildCfg } = getConfigFromInteraction(interaction) || {};

    const clubName =
      guildCfg?.clubName ||
      interaction.guild?.name ||
      globalCfg.botName ||
      'INTER GALACTIQUE';

    const color = getEmbedColorFromCfg(guildCfg);

    // Salon cible : option "salon" OU salon actuel
    const salon = interaction.options.getChannel('salon') || interaction.channel;

    if (!salon || !salon.isTextBased()) {
      return interaction.reply({
        content:
          '❌ Salon cible introuvable ou non textuel. Utilise cette commande dans un salon texte valide ou précise un salon.',
        ephemeral: true
      });
    }

    const mentionType = interaction.options.getString('mention') || 'none';
    const role = interaction.options.getRole('role') || null;

    if (mentionType === 'role' && !role) {
      return interaction.reply({
        content:
          '❌ Tu as choisi **Un rôle** à mentionner, mais aucun `role` n’a été fourni.',
        ephemeral: true
      });
    }

    await interaction.reply({
      content: '🛰️ Préparation de l’annonce…',
      ephemeral: true
    });

    /* =========================
       MODE LOGE OFFICIELLE
       ========================= */
    if (type === 'loge') {
      const user = interaction.options.getUser('joueur');
      if (!user) {
        return interaction.editReply(
          '❌ Tu dois préciser un `joueur` pour le mode **loge**.'
        );
      }

      const msg = [
        '## 🏟️・**BIENVENUE DANS L’EFFECTIF OFFICIEL**',
        '',
        `👋 **Bonjour <@${user.id}>**,`,
        '',
        `Tu intègres désormais **l’effectif officiel** de **${clubName}** 🌌`,
        'Félicitations et bienvenue parmi les **joueurs titulaires** de notre structure.',
        '',
        '💬 Tu disposes dès à présent d’une **LOGE PERSONNELLE**, ton canal **privé et exclusif** avec le staff.',
        '👉 C’est ton **seul espace de communication officielle** pour toute **demande**, **remarque** ou **signalement**.',
        '',
        '⚠️ **Aucun message privé adressé au staff ne sera pris en compte.**',
        'Toutes les discussions passent **obligatoirement** par ta **loge**.',
        '',
        '📸 Tu peux également y **envoyer une capture d’écran de ton pro** ou une **photo** si tu souhaites qu’on te crée une **photo de profil personnalisée**.',
        '',
        '---',
        '',
        '🎯 En rejoignant l’effectif, tu t’engages à faire preuve de **rigueur**, **respect** et **engagement**.',
        `Bienvenue dans l’aventure **${clubName}** 💫`,
        'Et surtout… **honore le maillot.**'
      ].join('\n');

      try {
        await salon.send({
          content: msg,
          allowedMentions: { users: [user.id], parse: [] }
        });
        return interaction.editReply(
          `✅ Annonce de loge envoyée dans <#${salon.id}>.`
        );
      } catch (e) {
        console.error('Erreur envoi annonce loge :', e);
        return interaction.editReply(
          '❌ Impossible d’envoyer le message (vérifie mes permissions).'
        );
      }
    }

    /* =========================
       MODE SIGNATURE OFFICIELLE
       ========================= */
    if (type === 'signature') {
      const user = interaction.options.getUser('joueur');
      if (!user) {
        return interaction.editReply(
          '❌ Tu dois préciser un `joueur` pour le mode **signature**.'
        );
      }

      const messagePerso = interaction.options.getString('message') || '';
      const changerRoles =
        interaction.options.getBoolean('changer_roles') ?? true;
      const roleJoueur = interaction.options.getRole('role_joueur') || null;
      const roleEssai = interaction.options.getRole('role_essai') || null;

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

      // Annonce publique
      try {
        await salon.send({
          embeds: [embed],
          allowedMentions: { users: [user.id] }
        });
      } catch (err) {
        console.error('Erreur envoi annonce signature :', err);
        return interaction.editReply({
          content:
            '❌ Impossible d’envoyer l’annonce (permissions manquantes ?).'
        });
      }

      // Gestion des rôles
      let rolesLog = '—';
      if (changerRoles) {
        if (!roleJoueur && !roleEssai) {
          rolesLog =
            '⚠️ Aucun rôle fourni (`role_joueur` / `role_essai`), aucun changement effectué.';
        } else {
          try {
            const membre = await interaction.guild.members.fetch(user.id);
            const me = interaction.guild.members.me;

            const canManage =
              me.permissions.has(PermissionFlagsBits.ManageRoles) &&
              (!roleJoueur || me.roles.highest.position > roleJoueur.position) &&
              (!roleEssai || me.roles.highest.position > roleEssai.position);

            if (!canManage) {
              rolesLog =
                '⚠️ Je ne peux pas modifier ces rôles (hiérarchie ou permission manquante).';
            } else {
              if (roleEssai && membre.roles.cache.has(roleEssai.id)) {
                await membre.roles.remove(
                  roleEssai,
                  'Fin de période d’essai — signature officielle'
                );
              }
              if (roleJoueur && !membre.roles.cache.has(roleJoueur.id)) {
                await membre.roles.add(
                  roleJoueur,
                  'Signature officielle — ajout du rôle Joueur'
                );
              }
              rolesLog = '✅ Rôles mis à jour selon les options fournies.';
            }
          } catch (e) {
            console.error('Erreur mise à jour rôles :', e);
            rolesLog = '❌ Échec de mise à jour des rôles.';
          }
        }
      } else {
        rolesLog = '⏭️ Changement de rôles désactivé pour cette signature.';
      }

      return interaction.editReply({
        content: [
          `✅ Signature annoncée dans <#${salon.id}> pour <@${user.id}>.`,
          `🧩 Rôles : ${rolesLog}`
        ].join('\n')
      });
    }

    // À partir d’ici : uniquement pour "interne" et "communique"
    const rawContenu = interaction.options.getString('contenu');
    if (!rawContenu) {
      return interaction.editReply(
        '❌ Tu dois renseigner `contenu` pour ce type d’annonce.'
      );
    }

    const contenu = sanitize(rawContenu);
    const titre =
      sanitize(interaction.options.getString('titre')) ||
      (type === 'communique'
        ? '✦ COMMUNIQUÉ OFFICIEL ✦'
        : '🗞️ ANNONCE INTERNE');

    const mentionLine = buildMention(mentionType, role);
    const allowedMentionHeader =
      mentionType === 'everyone'
        ? { parse: ['everyone'] }
        : mentionType === 'here'
        ? { parse: ['everyone'] } // @here fonctionne aussi avec parse: ['everyone']
        : mentionType === 'role'
        ? { roles: [role.id] }
        : { parse: [] };

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
        if (mentionLine) {
          await salon.send({
            content: mentionLine,
            allowedMentions: allowedMentionHeader
          });
        }
        await salon.send({
          embeds: [embed],
          allowedMentions: { parse: [] }
        });
        return interaction.editReply(
          `✅ Annonce interne publiée dans <#${salon.id}>.`
        );
      } catch (e) {
        console.error('Erreur envoi annonce interne :', e);
        return interaction.editReply(
          '❌ Impossible de publier l’annonce (vérifie mes permissions).'
        );
      }
    }

    /* ======================
       MODE COMMUNIQUÉ OFFICIEL
       ====================== */
    if (type === 'communique') {
      const imageFile = interaction.options.getAttachment('image_fichier') || null;
      const imageUrl = interaction.options.getString('image_url') || null;
      const boutonLibelle = interaction.options.getString('bouton_libelle') || null;
      const boutonURL = interaction.options.getString('bouton_url') || null;
      const addReactions = interaction.options.getBoolean('reactions') ?? false;

      if ((boutonLibelle && !boutonURL) || (!boutonLibelle && boutonURL)) {
        return interaction.editReply(
          '❌ Pour ajouter un bouton, renseigne **libellé + URL**.'
        );
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
        if (mentionLine) {
          await salon.send({
            content: mentionLine,
            allowedMentions: allowedMentionHeader
          });
        }

        const sent = await salon.send({
          embeds: [embed],
          components,
          allowedMentions: { parse: [] }
        });

        if (addReactions) {
          try {
            await sent.react('✅');
            await sent.react('❌');
          } catch {
            // non bloquant
          }
        }

        return interaction.editReply(
          `✅ Communiqué publié dans <#${salon.id}>.`
        );
      } catch (e) {
        console.error('Erreur envoi communiqué :', e);
        return interaction.editReply(
          '❌ Impossible de publier le communiqué (vérifie mes permissions).'
        );
      }
    }

    // Sécurité (ne devrait jamais arriver)
    return interaction.editReply('❌ Type d’annonce inconnu.');
  }
};
