import type { Dictionary } from '../types.ts';

/** Français. Vouvoiement, comme dans la plupart des messageries. */
export const FR: Dictionary = {
  // Navigation
  Admin: 'Administration',
  Calls: 'Appels',
  Communities: 'Communautés',
  Files: 'Fichiers',
  Friends: 'Amis',
  Home: 'Accueil',
  Messages: 'Messages',
  Security: 'Sécurité',
  Settings: 'Paramètres',
  Social: 'Social',

  // Phone shell
  Chat: 'Discussion',
  Feed: 'Fil',
  'This screen': 'Cet écran',
  Back: 'Retour',

  // Chats
  Archive: 'Archiver',
  'Archived chats': 'Discussions archivées',
  Attachment: 'Pièce jointe',
  Blocked: 'Bloqué',
  Chats: 'Discussions',
  'Clear search': 'Effacer la recherche',
  'Delete chat': 'Supprimer la discussion',
  'Direct messages start once you have an account — join a community with an invite link.':
    'Les messages privés commencent dès que vous avez un compte : rejoignez une communauté avec un lien d’invitation.',
  'Edit folder {name}': 'Modifier le dossier {name}',
  'Invited you to a group': 'Vous a invité dans un groupe',
  'Mark as unread': 'Marquer comme non lu',
  'Marked unread': 'Marqué comme non lu',
  'Message requests': 'Demandes de message',
  'Messages found': 'Messages trouvés',
  Muted: 'En sourdine',
  'New chat folder': 'Nouveau dossier',
  'No archived chats.': 'Aucune discussion archivée.',
  'No chats yet. Start one with a friend.': 'Aucune discussion pour l’instant. Lancez-en une avec un ami.',
  'No messages yet': 'Aucun message pour l’instant',
  'Note to self': 'Notes personnelles',
  'Notes, links and files for yourself': 'Notes, liens et fichiers pour vous',
  'Nothing here.': 'Rien ici.',
  'One more step': 'Encore une étape',
  'Paste the sign-up link from whoever runs your River server in the card above.':
    'Collez dans la carte ci-dessus le lien d’inscription fourni par la personne qui gère votre serveur River.',
  Pin: 'Épingler',
  'Pin to top': 'Épingler en haut',
  Pinned: 'Épinglé',
  Read: 'Lu',
  'River keeps trying by itself. Your chats appear here as soon as it is ready.':
    'River continue d’essayer tout seul. Vos discussions apparaîtront ici dès que tout sera prêt.',
  Search: 'Rechercher',
  'Search chats and messages': 'Rechercher dans les discussions et messages',
  'Setting up your account…': 'Configuration de votre compte…',
  'Show conversations': 'Afficher les conversations',
  'Start a chat': 'Démarrer une discussion',
  Unarchive: 'Désarchiver',
  Unpin: 'Désépingler',
  'Waiting for network…': 'En attente du réseau…',
  'You left this group': 'Vous avez quitté ce groupe',

  // First steps
  'Add a friend': 'Ajouter un ami',
  'Find them by @username, or scan their QR code': 'Trouvez-le par @nom d’utilisateur ou scannez son code QR',
  'Friends scan it, or you send them your link': 'Vos amis le scannent, ou vous leur envoyez votre lien',
  'Paste an invite link, or start your own': 'Collez un lien d’invitation ou créez la vôtre',
  'Show my QR code': 'Afficher mon code QR',

  // Calls
  'Declined video': 'Appel vidéo refusé',
  'Declined voice': 'Appel refusé',
  'Incoming video': 'Appel vidéo entrant',
  'Incoming voice': 'Appel entrant',
  'Missed video': 'Appel vidéo manqué',
  'Missed voice': 'Appel manqué',
  'No account yet': 'Pas encore de compte',
  'No calls yet. Call a friend from your chat with them.':
    'Aucun appel pour l’instant. Appelez un ami depuis votre discussion.',
  'No missed calls.': 'Aucun appel manqué.',
  'Outgoing video': 'Appel vidéo sortant',
  'Outgoing voice': 'Appel sortant',
  'Show calls': 'Afficher les appels',

  // Communities
  Community: 'Communauté',
  'Community options': 'Options de la communauté',
  'Create or join a community': 'Créer ou rejoindre une communauté',
  Events: 'Événements',
  'Got an invite link? Paste it to join. Or start one for your friends from a template.':
    'Vous avez un lien d’invitation ? Collez-le pour rejoindre. Ou créez-en une pour vos amis à partir d’un modèle.',
  'Join or create a community': 'Rejoindre ou créer une communauté',
  'Leave {name}': 'Quitter {name}',
  'Mark all as read': 'Tout marquer comme lu',
  'Messages here are end-to-end encrypted with the community key':
    'Les messages ici sont chiffrés de bout en bout avec la clé de la communauté',
  'New community': 'Nouvelle communauté',
  'Nickname & picture here': 'Pseudo et photo ici',
  'No communities yet': 'Aucune communauté pour l’instant',
  'Unread messages': 'Messages non lus',
  'You will not be able to rejoin unless someone invites you again.':
    'Vous ne pourrez pas revenir sans une nouvelle invitation.',
  'Your communities': 'Vos communautés',

  // Settings tab (phone)
  'Calls, voice and video': 'Appels, voix et vidéo',
  'Copy your River ID': 'Copier votre River ID',
  'Data and backup': 'Données et sauvegarde',
  Devices: 'Appareils',
  'Edit your profile': 'Modifier votre profil',
  'Help and about River': 'Aide et à propos de River',
  'Local only · no account yet': 'Local uniquement · pas encore de compte',
  'My profile': 'Mon profil',
  'No username yet': 'Pas encore de nom d’utilisateur',
  'Not set up': 'Non configuré',
  'Notifications and sounds': 'Notifications et sons',
  'Phone and battery': 'Téléphone et batterie',
  'Privacy and security': 'Confidentialité et sécurité',
  'River ID {id}': 'River ID {id}',
  'Set your status': 'Définir votre statut',

  // First run
  'Add a photo (optional)': 'Ajouter une photo (facultatif)',
  'Both are optional, and you can change them any time.':
    'Les deux sont facultatifs et modifiables à tout moment.',
  'Change your photo': 'Changer votre photo',
  'Chats, calls and communities, end-to-end encrypted. No phone number or e-mail needed.':
    'Discussions, appels et communautés, chiffrés de bout en bout. Sans numéro de téléphone ni e-mail.',
  'e.g. Alex': 'p. ex. Alex',
  'Follow my system': 'Comme le système',
  'Get started': 'Commencer',
  'I already use River — link this device': 'J’utilise déjà River — associer cet appareil',
  'Join the community': 'Rejoindre la communauté',
  'Joining the community…': 'Connexion à la communauté…',
  Language: 'Langue',
  Photo: 'Photo',
  'Restore from a backup': 'Restaurer une sauvegarde',
  'River could not join that community: {reason}': 'River n’a pas pu rejoindre cette communauté : {reason}',
  'River could not set itself up. Please try again.': 'River n’a pas pu se configurer. Veuillez réessayer.',
  'Setting up River…': 'Configuration de River…',
  'That link code is for a device without River yet. Open it on the device you are adding.':
    'Ce code est destiné à un appareil sans River. Ouvrez-le sur l’appareil que vous ajoutez.',
  'That picture is too large.': 'Cette image est trop grande.',
  'Use 64 characters or fewer.': '64 caractères maximum.',
  'Welcome to River': 'Bienvenue sur River',
  "You're invited to a community. Pick a name and you're in.":
    'Vous êtes invité dans une communauté. Choisissez un nom et c’est parti.',
  'Your name': 'Votre nom',

  // Join a community
  'Community invite link': 'Lien d’invitation de la communauté',
  'Got an invite link? Paste it here — River does the rest.':
    'Vous avez un lien d’invitation ? Collez-le ici, River s’occupe du reste.',
  Join: 'Rejoindre',
  'Join a community': 'Rejoindre une communauté',
  'Joining…': 'Connexion…',
  'Or start your own community': 'Ou créez votre propre communauté',
  'Paste an invite link': 'Collez un lien d’invitation',

  // Lock screen
  'A few unrelated words make a strong passphrase. If you forget it, River’s local data on this computer cannot be recovered.':
    'Quelques mots sans rapport font une phrase secrète solide. Si vous l’oubliez, les données locales de River sur cet ordinateur ne pourront pas être récupérées.',
  'Encrypting…': 'Chiffrement…',
  'Enter your passphrase to decrypt River’s local data.':
    'Saisissez votre phrase secrète pour déchiffrer les données locales de River.',
  Passphrase: 'Phrase secrète',
  'Please try again.': 'Veuillez réessayer.',
  'Protect River with a passphrase': 'Protégez River par une phrase secrète',
  'Repeat passphrase': 'Répétez la phrase secrète',
  'River can’t open its local data': 'River ne peut pas ouvrir ses données locales',
  'Set passphrase': 'Définir la phrase secrète',
  'Something went wrong. Please try again.': 'Un problème est survenu. Veuillez réessayer.',
  'That passphrase is not correct.': 'Cette phrase secrète est incorrecte.',
  'The passphrases do not match.': 'Les phrases secrètes ne correspondent pas.',
  'This computer has no system keyring River can use, so River will encrypt its local data with a passphrase you choose. You will enter it each time River starts.':
    'Cet ordinateur n’a pas de trousseau système utilisable par River ; River chiffrera donc ses données locales avec une phrase secrète de votre choix. Vous la saisirez à chaque démarrage de River.',
  Unlock: 'Déverrouiller',
  'Unlock River': 'Déverrouiller River',
  'Unlocking…': 'Déverrouillage…',
  'Use at least {count} characters.': 'Au moins {count} caractères.',
  'Use at most {count} characters.': '{count} caractères maximum.',

  // Errors
  Reload: 'Recharger',
  'River ran into a problem while drawing this window. Your messages and keys are safe.':
    'River a rencontré un problème en affichant cette fenêtre. Vos messages et vos clés sont en sécurité.',
  'Something went wrong': 'Un problème est survenu',
  'Try again': 'Réessayer',
  '{area} could not be shown. The rest of River still works.':
    '« {area} » n’a pas pu s’afficher. Le reste de River fonctionne toujours.',

  // Status
  '1 hour': '1 heure',
  '30 minutes': '30 minutes',
  '4 hours': '4 heures',
  'Choose an emoji': 'Choisir un emoji',
  'Clear after': 'Effacer après',
  'Clear custom status': 'Effacer le statut personnalisé',
  'Custom status': 'Statut personnalisé',
  'Don’t clear': 'Ne pas effacer',
  'Edit custom status': 'Modifier le statut personnalisé',
  'Edit profile': 'Modifier le profil',
  'Emoji {emoji}, change': 'Emoji {emoji}, changer',
  'Everyone in your communities sees it. It is end-to-end encrypted like the rest of your profile.':
    'Tout le monde dans vos communautés le voit. Il est chiffré de bout en bout comme le reste de votre profil.',
  Invisible: 'Invisible',
  'Set a custom status': 'Définir un statut personnalisé',
  'What’s happening?': 'Quoi de neuf ?',
  'You won’t get notifications or notification sounds.':
    'Vous ne recevrez ni notifications ni sons de notification.',
  'Your status': 'Votre statut',
  'You’ll appear offline but can use River as usual.':
    'Vous apparaîtrez hors ligne, mais pourrez utiliser River normalement.',
  'Do Not Disturb': 'Ne pas déranger',
  Idle: 'Absent',
  Offline: 'Hors ligne',
  Online: 'En ligne',

  // Sidebar and voice panel
  'Call ended unexpectedly': 'L’appel s’est terminé de façon inattendue',
  'Community settings': 'Paramètres de la communauté',
  'Create category': 'Créer une catégorie',
  Disconnect: 'Déconnecter',
  Dismiss: 'Fermer',
  'Duplicate channel': 'Dupliquer le salon',
  'Edit channel': 'Modifier le salon',
  'Invite people': 'Inviter des personnes',
  'Leave community': 'Quitter la communauté',
  'Pick your roles': 'Choisir vos rôles',
  'Push to talk': 'Appuyer pour parler',
  'Reconnecting…': 'Reconnexion…',
  Rejoin: 'Revenir',
  'Voice connected': 'Vocal connecté',
  You: 'Vous',

  // Updates
  'A downloaded update failed signature verification and was not installed.':
    'Une mise à jour téléchargée n’a pas passé la vérification de signature et n’a pas été installée.',
  'Allow River to install updates in Android’s settings, then tap Install.':
    'Autorisez River à installer des mises à jour dans les paramètres d’Android, puis touchez Installer.',
  Details: 'Détails',
  Download: 'Télécharger',
  'Download it from the release page.': 'Téléchargez-la depuis la page des versions.',
  'Downloaded and signature-verified.': 'Téléchargée et signature vérifiée.',
  'Downloaded and signature-verified. Android asks you to confirm.':
    'Téléchargée et signature vérifiée. Android vous demandera de confirmer.',
  Install: 'Installer',
  'It is signed with a new key, so it cannot replace this River. Back up before uninstalling.':
    'Elle est signée avec une nouvelle clé et ne peut donc pas remplacer ce River. Faites une sauvegarde avant de désinstaller.',
  Restart: 'Redémarrer',
  'River {version} is available': 'River {version} est disponible',
  'River {version} is ready': 'River {version} est prêt',
  'River {version} needs a fresh install': 'River {version} nécessite une nouvelle installation',
  'Update blocked': 'Mise à jour bloquée',

  // Settings
  '12-hour': '12 heures',
  '24-hour': '24 heures',
  About: 'À propos',
  'About River': 'À propos de River',
  Account: 'Compte',
  'Account ID': 'ID du compte',
  'Add previews to links I send': 'Ajouter un aperçu aux liens que j’envoie',
  'All animations, including the network field.': 'Toutes les animations, y compris le champ réseau.',
  'App settings': 'Paramètres de l’app',
  Appearance: 'Apparence',
  'Ask for your fingerprint, face or screen lock whenever River opens. Needs a screen lock on this phone. Your messages are encrypted on the phone either way; this keeps out someone holding your unlocked phone.':
    'Demande votre empreinte, votre visage ou le verrouillage de l’écran à chaque ouverture de River. Nécessite un verrouillage d’écran sur ce téléphone. Vos messages sont chiffrés sur le téléphone dans tous les cas ; cela bloque quelqu’un qui tiendrait votre téléphone déverrouillé.',
  Automatic: 'Automatique',
  'Back up first': 'Sauvegarder d’abord',
  Backup: 'Sauvegarde',
  Beta: 'Bêta',
  'Block screenshots and screen recording of River, and show it blank in the app switcher.':
    'Bloque les captures et enregistrements d’écran de River, et l’affiche vide dans le sélecteur d’apps.',
  'Brighter text, clearer borders and strong focus outlines.':
    'Texte plus lumineux, bordures plus nettes et contours de focus marqués.',
  Change: 'Changer',
  Channel: 'Canal',
  'Chat sounds': 'Sons des discussions',
  'Check for updates automatically': 'Rechercher les mises à jour automatiquement',
  'Check now': 'Rechercher',
  'Checking for updates…': 'Recherche de mises à jour…',
  'Checks GitHub Releases about every four hours.':
    'Consulte GitHub Releases environ toutes les quatre heures.',
  'Checks GitHub Releases about every six hours.': 'Consulte GitHub Releases environ toutes les six heures.',
  Clock: 'Horloge',
  'Close settings': 'Fermer les paramètres',
  Compact: 'Compacte',
  Connected: 'Connecté',
  'Connecting…': 'Connexion…',
  Connection: 'Connexion',
  Contrast: 'Contraste',
  Cozy: 'Aérée',
  'Development builds. May break. For testers only.':
    'Versions de développement. Peuvent casser. Pour les testeurs.',
  'Device {device} of {devices} · list v{version}': 'Appareil {device} sur {devices} · liste v{version}',
  'Download update': 'Télécharger la mise à jour',
  'Download updates automatically': 'Télécharger les mises à jour automatiquement',
  'Download {version}': 'Télécharger {version}',
  'Downloading River {version}… {percent}%': 'Téléchargement de River {version}… {percent} %',
  'Every day, no pop-ups or notification sounds between these times.':
    'Chaque jour, ni fenêtres ni sons de notification entre ces heures.',
  'Every download is verified against River’s release signature before it can be installed.':
    'Chaque téléchargement est vérifié avec la signature des versions de River avant de pouvoir être installé.',
  'Every download is verified against River’s release signature. Android asks you before it installs anything.':
    'Chaque téléchargement est vérifié avec la signature des versions de River. Android vous demande avant toute installation.',
  'Follow system': 'Comme le système',
  'Follow your language settings.': 'Selon vos réglages de langue.',
  From: 'De',
  Full: 'Complet',
  General: 'Général',
  Hidden: 'Masqué',
  'High contrast': 'Contraste élevé',
  'Host on this PC': 'Héberger sur ce PC',
  Hosting: 'Hébergement',
  'Install update': 'Installer la mise à jour',
  'Install verified updates by themselves': 'Installer seules les mises à jour vérifiées',
  'Installing River {version}… Confirm in Android’s installer. River closes while it updates; open it again afterwards.':
    'Installation de River {version}… Confirmez dans l’installateur d’Android. River se ferme pendant la mise à jour ; rouvrez-le ensuite.',
  'Interface size': 'Taille de l’interface',
  'Keep River out of screenshots and screen recordings (including screen sharing of this window).':
    'Exclut River des captures et enregistrements d’écran (y compris le partage de cette fenêtre).',
  'Keep River running when I close the window': 'Garder River actif quand je ferme la fenêtre',
  'Larger avatars and more space between messages.':
    'Avatars plus grands et plus d’espace entre les messages.',
  'Let people see when you have read their direct messages. If you turn this off, you will not see when they read yours either.':
    'Les autres voient quand vous avez lu leurs messages privés. Si vous le désactivez, vous ne verrez pas non plus quand ils lisent les vôtres.',
  License: 'Licence',
  'Light up the screen for new messages': 'Allumer l’écran pour les nouveaux messages',
  'Lock River': 'Verrouiller River',
  'Long-press a chat, or open a community’s menu, to mute it for an hour, 8 hours, a day or until you turn it back on, to choose All messages, Only @mentions or Nothing just for it, and to give it a sound of its own. A community can also ignore @everyone and @here. Mentions of you and replies to you still come through a muted chat or channel unless it is set to Nothing. Do Not Disturb (your status in Settings) silences everything except your own sounds.':
    'Appuyez longuement sur une discussion, ou ouvrez le menu d’une communauté, pour la mettre en sourdine une heure, 8 heures, un jour ou jusqu’à réactivation, choisir pour elle seule Tous les messages, Seulement les @mentions ou Rien, et lui donner son propre son. Une communauté peut aussi ignorer @everyone et @here. Les mentions et réponses qui vous concernent passent même en sourdine, sauf si Rien est choisi. Ne pas déranger (votre statut dans Paramètres) coupe tout sauf vos propres sons.',
  'Message density': 'Densité des messages',
  'Message text size': 'Taille du texte des messages',
  'Minimal animation everywhere.': 'Animations minimales partout.',
  'More messages on screen: small avatars, tight spacing.':
    'Plus de messages à l’écran : petits avatars, espacement réduit.',
  Motion: 'Animations',
  'New features a little earlier. Occasional rough edges.':
    'Les nouveautés un peu plus tôt. Parfois quelques défauts.',
  'New messages and calls notify you even when River is closed. Android shows a quiet “River is connected” notification while it runs, and it uses some battery. River does not use Google’s push service.':
    'Les nouveaux messages et appels vous préviennent même quand River est fermé. Android affiche une notification discrète « River est connecté » pendant ce temps, et cela consomme un peu de batterie. River n’utilise pas le service push de Google.',
  Nightly: 'Nightly',
  'Not checked yet.': 'Pas encore vérifié.',
  'Notification preview': 'Aperçu des notifications',
  'Notification text is shown by your operating system and may be visible on your lock screen.':
    'Le texte des notifications est affiché par votre système et peut être visible sur l’écran de verrouillage.',
  Notifications: 'Notifications',
  "Offline — you'll reconnect automatically": 'Hors ligne — reconnexion automatique',
  'On iPhone, River gets messages and calls only while it is open or was just in use. River does not use Apple’s push service yet (it needs a paid Apple developer account), so once iOS pauses River, new messages and calls wait until you open it again. Calls do not ring while River is closed.':
    'Sur iPhone, River reçoit messages et appels seulement lorsqu’il est ouvert ou vient d’être utilisé. River n’utilise pas encore le service push d’Apple (il faut un compte développeur Apple payant) ; dès qu’iOS met River en pause, les nouveaux messages et appels attendent que vous le rouvriez. Les appels ne sonnent pas quand River est fermé.',
  'On now: no pop-ups or notification sounds until it ends.':
    'Actif : ni fenêtres ni sons de notification jusqu’à la fin.',
  'Open download page': 'Ouvrir la page de téléchargement',
  'Partly translated: some screens are still in English.':
    'Traduction partielle : certains écrans sont encore en anglais.',
  Platform: 'Plateforme',
  Privacy: 'Confidentialité',
  Problem: 'Problème',
  Profile: 'Profil',
  'Quiet hours': 'Heures calmes',
  'Read receipts': 'Accusés de lecture',
  Reduced: 'Réduites',
  'Release channel': 'Canal de versions',
  Releases: 'Versions',
  'Report a problem': 'Signaler un problème',
  'Restart and update': 'Redémarrer et mettre à jour',
  'Right-click a chat, community, category or channel to mute it for an hour, 8 hours, a day or until you turn it back on, to choose All messages, Only @mentions or Nothing just for it, and to give it a sound of its own. A community can also ignore @everyone and @here. Mentions of you and replies to you still come through a muted chat or channel unless it is set to Nothing. Do Not Disturb (click your name) silences everything except your own sounds.':
    'Faites un clic droit sur une discussion, une communauté, une catégorie ou un salon pour le mettre en sourdine une heure, 8 heures, un jour ou jusqu’à réactivation, choisir pour lui seul Tous les messages, Seulement les @mentions ou Rien, et lui donner son propre son. Une communauté peut aussi ignorer @everyone et @here. Les mentions et réponses qui vous concernent passent même en sourdine, sauf si Rien est choisi. Ne pas déranger (cliquez sur votre nom) coupe tout sauf vos propres sons.',
  'River fetches the page from your computer (the site sees your address) and adds its title and description to your encrypted message. People reading it never contact the site.':
    'River charge la page depuis votre ordinateur (le site voit votre adresse) et ajoute son titre et sa description à votre message chiffré. Les lecteurs ne contactent jamais le site.',
  'River is free, open-source software. Anyone can read, audit and build the code that runs on your device.':
    'River est un logiciel libre et open source. Chacun peut lire, auditer et compiler le code qui tourne sur votre appareil.',
  'River is up to date. Last checked {time}.': 'River est à jour. Dernière vérification : {time}.',
  'River opens quietly in the tray, so you get messages and calls right away.':
    'River s’ouvre discrètement dans la zone de notification pour recevoir messages et appels tout de suite.',
  "River stays in the tray. Quit it from the tray icon's menu.":
    'River reste dans la zone de notification. Quittez-le depuis le menu de son icône.',
  'River stores your account ID, your public keys and which devices you use — never your messages or your name.':
    'River conserve l’ID de votre compte, vos clés publiques et vos appareils utilisés — jamais vos messages ni votre nom.',
  'River {version} is available.': 'River {version} est disponible.',
  'River {version} is available. On macOS, download it from the release page.':
    'River {version} est disponible. Sur macOS, téléchargez-le depuis la page des versions.',
  'River {version} is downloaded and verified. Android needs your permission first: turn on “Allow from this source” for River in the settings screen that opened, then come back and tap Install update.':
    'River {version} est téléchargé et vérifié. Android a d’abord besoin de votre autorisation : activez « Autoriser cette source » pour River dans l’écran de paramètres ouvert, puis revenez et touchez Installer la mise à jour.',
  'River {version} is downloaded and verified. Restart to finish updating.':
    'River {version} est téléchargé et vérifié. Redémarrez pour terminer la mise à jour.',
  'River {version} is downloaded and verified. Tap Install update; Android asks you to confirm.':
    'River {version} est téléchargé et vérifié. Touchez Installer la mise à jour ; Android vous demandera de confirmer.',
  'River’s usual colours.': 'Les couleurs habituelles de River.',
  'Run a River server on this PC…': 'Lancer un serveur River sur ce PC…',
  'Saved. People can add you as @{name}.': 'Enregistré. On peut vous ajouter avec @{name}.',
  'Saving…': 'Enregistrement…',
  'Screen security': 'Sécurité de l’écran',
  'Sender and message': 'Expéditeur et message',
  'Sender only': 'Expéditeur seulement',
  'Set username': 'Choisir un nom d’utilisateur',
  'Settings sections': 'Sections des paramètres',
  'Shortcut: {key}= bigger, {key}− smaller, {key}0 normal.':
    'Raccourcis : {key}= plus grand, {key}− plus petit, {key}0 normal.',
  'Show “typing…” while you write. If you turn this off, you will not see others typing either.':
    'Affiche « écrit… » pendant que vous écrivez. Si vous le désactivez, vous ne verrez pas non plus les autres écrire.',
  'Shows a preview of the message.': 'Affiche un aperçu du message.',
  'Source code': 'Code source',
  Stable: 'Stable',
  Standard: 'Standard',
  'Start River when I sign in': 'Lancer River à l’ouverture de session',
  'Stay connected': 'Rester connecté',
  System: 'Système',
  'Technical details': 'Détails techniques',
  'Tested releases. Recommended for everyone.': 'Versions testées. Recommandé pour tous.',
  'The quick brown fox says hi 👋': 'Le vif renard brun dit bonjour 👋',
  'This device': 'Cet appareil',
  to: 'à',
  'Try now': 'Réessayer maintenant',
  'Typing indicators': 'Indicateurs de saisie',
  Updates: 'Mises à jour',
  'Use high contrast when your system asks for more contrast.':
    'Contraste élevé quand votre système demande plus de contraste.',
  'Use your operating system’s reduced-motion setting.':
    'Suit le réglage « réduire les animations » du système.',
  'User settings': 'Paramètres utilisateur',
  username: 'nom d’utilisateur',
  'Username — how people add you': 'Nom d’utilisateur — pour qu’on vous ajoute',
  'Verifying the signature of River {version}…': 'Vérification de la signature de River {version}…',
  Version: 'Version',
  'Voice & video': 'Voix et vidéo',
  'When River is in the tray or you have not used it for 10 minutes, and never during a call. A PC that hosts River does it at night.':
    'Quand River est dans la zone de notification ou inutilisé depuis 10 minutes, et jamais pendant un appel. Un PC qui héberge River le fait la nuit.',
  'When the screen is off, a new message turns it on for a few seconds. Not during Do Not Disturb, and not for messages sent without sound.':
    'Écran éteint, un nouveau message l’allume quelques secondes. Pas en mode Ne pas déranger, ni pour les messages envoyés sans son.',
  'You have unsaved changes. Leave without saving them?':
    'Vous avez des modifications non enregistrées. Quitter sans enregistrer ?',
  'You will receive pre-release builds. They are signed like every release, but may contain bugs. Switching back to Stable takes effect at the next stable version newer than the one you have.':
    'Vous recevrez des préversions. Elles sont signées comme toutes les versions, mais peuvent contenir des bugs. Le retour à Stable prend effet à la prochaine version stable plus récente que la vôtre.',
  'Your account': 'Votre compte',
  '“New message from Alex”.': '« Nouveau message d’Alex ».',
  '“New River message” — no name, no content.': '« Nouveau message River » — sans nom ni contenu.',

  // Conversations
  All: 'Tous',
  'Attach files': 'Joindre des fichiers',
  'Conversation options': 'Options de la conversation',
  Delete: 'Supprimer',
  'Delete conversation with {name}': 'Supprimer la conversation avec {name}',
  Encrypted: 'Chiffré',
  'End-to-end encrypted': 'Chiffré de bout en bout',
  'Files are encrypted on your device before upload.':
    'Les fichiers sont chiffrés sur votre appareil avant l’envoi.',
  'Find a conversation': 'Trouver une conversation',
  'Group members': 'Membres du groupe',
  Groups: 'Groupes',
  Message: 'Message',
  'Message {name}': 'Message à {name}',
  'Messages disappear after {time}': 'Les messages disparaissent après {time}',
  More: 'Plus',
  online: 'en ligne',
  'Only you': 'Vous seul',
  'Only you · kept on your devices': 'Vous seul · conservé sur vos appareils',
  People: 'Personnes',
  'Pinned messages': 'Messages épinglés',
  'Profile of {name}': 'Profil de {name}',
  'Search in this conversation': 'Rechercher dans cette conversation',
  'Send to {name}': 'Envoyer à {name}',
  'Start video call': 'Démarrer un appel vidéo',
  'Start voice call': 'Démarrer un appel',
  'This deletes the messages on this device only. The other person keeps their copy.':
    'Cela supprime les messages sur cet appareil uniquement. L’autre personne garde sa copie.',
  'typing…': 'écrit…',
  Unread: 'Non lus',
  Verified: 'Vérifié',
  'View safety number': 'Voir le numéro de sécurité',
  'You can attach up to {count} files to one message.':
    'Vous pouvez joindre jusqu’à {count} fichiers à un message.',
  'Your notes are kept on this device and copied to your linked devices':
    'Vos notes restent sur cet appareil et sont copiées sur vos appareils associés',
  '{name}, group members': '{name}, membres du groupe',
  '✓ Verified · end-to-end encrypted': '✓ Vérifié · chiffré de bout en bout',

  // Calls page
  'Anyone with a call link can ask to join; you let each person in. Good for calls with people outside a group.':
    'Toute personne ayant le lien peut demander à rejoindre ; vous admettez chacune. Pratique pour appeler des personnes hors d’un groupe.',
  Busy: 'Occupé',
  'Call a contact': 'Appeler un contact',
  'Call link': 'Lien d’appel',
  'Call link copied.': 'Lien d’appel copié.',
  'Call links': 'Liens d’appel',
  'Call {name}': 'Appeler {name}',
  'Calls need an account on a River server.': 'Les appels nécessitent un compte sur un serveur River.',
  'Copy call link': 'Copier le lien d’appel',
  'Copy the link': 'Copier le lien',
  'Could not connect': 'Connexion impossible',
  'Could not copy the link.': 'Impossible de copier le lien.',
  'Create call link': 'Créer un lien d’appel',
  Declined: 'Refusé',
  Incoming: 'Entrant',
  'Loading…': 'Chargement…',
  Missed: 'Manqué',
  'No answer': 'Pas de réponse',
  'No calls yet.': 'Aucun appel pour l’instant.',
  Outgoing: 'Sortant',
  Recent: 'Récents',
  'Recent calls': 'Appels récents',
  'Start the call of this link': 'Démarrer l’appel de ce lien',
  'Stop this call link': 'Désactiver ce lien d’appel',
  'Stop this link working': 'Désactiver ce lien',
  video: '(vidéo)',
  'Video call link': 'Lien d’appel vidéo',
  'Video call {name}': 'Appel vidéo avec {name}',
  'Voice and video calls go directly between devices, encrypted with DTLS-SRTP; call setup travels inside end-to-end encrypted messages. Your call history is kept only on this computer.':
    'Les appels audio et vidéo passent directement entre les appareils, chiffrés avec DTLS-SRTP ; leur établissement passe par des messages chiffrés de bout en bout. Votre historique d’appels reste sur cet ordinateur.',
  'Works until {date}': 'Valable jusqu’au {date}',
  'Your contacts appear here.': 'Vos contacts apparaissent ici.',
  '{name} · call link': '{name} · lien d’appel',
  '{name} · group call': '{name} · appel de groupe',
  '{name} · group call ({count})': '{name} · appel de groupe ({count})',

  // Time
  'just now': 'à l’instant',
  Today: 'Aujourd’hui',
  'Today at {time}': 'Aujourd’hui à {time}',
  Yesterday: 'Hier',
  'Yesterday at {time}': 'Hier à {time}',

  // Notifications
  '+{count} more': '+{count} autres',
  'A group call': 'Un appel de groupe',
  'An event you are interested in is starting': 'Un événement qui vous intéresse commence',
  'Incoming call': 'Appel entrant',
  'Incoming group call': 'Appel de groupe entrant',
  'Incoming group video call': 'Appel vidéo de groupe entrant',
  'Incoming video call': 'Appel vidéo entrant',
  'Mark as read': 'Marquer comme lu',
  'Missed call': 'Appel manqué',
  'Missed call from {name}': 'Appel manqué de {name}',
  'Missed group call in {group}': 'Appel de groupe manqué dans {group}',
  'New direct message': 'Nouveau message privé',
  'New friend request': 'Nouvelle demande d’ami',
  'New message': 'Nouveau message',
  Reply: 'Répondre',
  'River video call': 'Appel vidéo River',
  'River voice call': 'Appel River',
  'Sent a file': 'A envoyé un fichier',
  Someone: 'Quelqu’un',
  'Starting now': 'Commence maintenant',
  'Wants to be your friend': 'Veut devenir votre ami',
  'Wants to be your friend: {text}': 'Veut devenir votre ami : {text}',
  'You were mentioned': 'Vous avez été mentionné',
  '{name} is calling you': '{name} vous appelle',

  // Phone core
  'Group call': 'Appel de groupe',
  'River call': 'Appel River',
  'River group call': 'Appel de groupe River',
  'Voice channel': 'Salon vocal',

  // Chat
  'Add reaction': 'Ajouter une réaction',
  cancel: 'annuler',
  Cancel: 'Annuler',
  'Copy message link': 'Copier le lien du message',
  'Copy text': 'Copier le texte',
  'Could not load the messages.': 'Impossible de charger les messages.',
  'Create thread': 'Créer un fil',
  'Decrypting…': 'Déchiffrement…',
  'Delete message': 'Supprimer le message',
  'Edit message': 'Modifier le message',
  edited: 'modifié',
  'enter to': 'Entrée pour',
  'escape to': 'Échap pour',
  Forward: 'Transférer',
  'Jump to present': 'Aller aux plus récents',
  'Load older messages': 'Charger les messages précédents',
  'Loading messages…': 'Chargement des messages…',
  'Mark unread': 'Marquer comme non lu',
  New: 'Nouveaux',
  'Not sent': 'Non envoyé',
  'Open thread': 'Ouvrir le fil',
  'Pin message': 'Épingler le message',
  Quote: 'Citer',
  'Remove from saved': 'Retirer des enregistrés',
  'Report message': 'Signaler le message',
  Retry: 'Réessayer',
  save: 'enregistrer',
  Save: 'Enregistrer',
  'Save message': 'Enregistrer le message',
  'Select messages': 'Sélectionner des messages',
  'Sending…': 'Envoi…',
  'Several people are typing…': 'Plusieurs personnes écrivent…',
  'Show less': 'Afficher moins',
  'Show more': 'Afficher plus',
  'Unpin message': 'Désépingler le message',
  'View reactions': 'Voir les réactions',
  '{names} are typing…': '{names} écrivent…',
  '{name} is typing…': '{name} écrit…',

  // Channels and categories
  'Collapse category': 'Replier la catégorie',
  'Create channel': 'Créer un salon',
  'Edit category': 'Modifier la catégorie',
  'Expand category': 'Déplier la catégorie',
  'Mark category as read': 'Marquer la catégorie comme lue',

  // Community settings
  'Careful — you have unsaved changes!': 'Attention — vous avez des modifications non enregistrées !',
  'Create role': 'Créer un rôle',
  'Delete role': 'Supprimer le rôle',
  'Edit role': 'Modifier le rôle',
  Reset: 'Réinitialiser',
  'Save changes': 'Enregistrer',
  'View role': 'Voir le rôle',
  'Audit log': 'Journal d’audit',
  Bans: 'Bannissements',
  Emoji: 'Emoji',
  Insights: 'Statistiques',
  Invites: 'Invitations',
  Members: 'Membres',
  Overview: 'Vue d’ensemble',
  Reports: 'Signalements',
  Roles: 'Rôles',
  'Rules & roles': 'Règles et rôles',
  Soundboard: 'Soundboard',
  Stickers: 'Stickers',
  Webhooks: 'Webhooks',

  // Voice
  'Camera off': 'Couper la caméra',
  'Camera on': 'Activer la caméra',
  Deafen: 'Mettre le son en sourdine',
  Leave: 'Quitter',
  Mute: 'Couper le micro',
  'Share screen': 'Partager l’écran',
  'Stop sharing': 'Arrêter le partage',
  Undeafen: 'Rétablir le son',
  Unmute: 'Activer le micro',

  'Create your identity before creating an account.': 'Créez votre identité avant de créer un compte.',
  'This device already has an account.': 'Cet appareil a déjà un compte.',
  'Set a valid server address first.': 'Indiquez d’abord une adresse de serveur valide.',
  'This server uses a River protocol version this app does not support.':
    'Ce serveur utilise une version du protocole River que cette application ne prend pas en charge.',
  'The server answered for a different account.': 'Le serveur a répondu pour un autre compte.',
  'Link this device first.': 'Associez d’abord cet appareil.',
  'The server returned account data that does not match the link.':
    'Le serveur a renvoyé des données de compte qui ne correspondent pas au lien.',
  'Connect to your server first, then try again.': 'Connectez-vous d’abord à votre serveur, puis réessayez.',
  'The server returned a device list that is not signed by your identity.':
    'Le serveur a renvoyé une liste d’appareils qui n’est pas signée par votre identité.',
  'The server returned an older or foreign device list. Nothing was changed.':
    'Le serveur a renvoyé une liste d’appareils plus ancienne ou étrangère. Rien n’a été modifié.',
  'There is no account to delete.': 'Il n’y a aucun compte à supprimer.',
  'There is no account to set up again.': 'Il n’y a aucun compte à reconfigurer.',
  'There is no account to link again.': 'Il n’y a aucun compte à réassocier.',
  'Your account is fine — this device is still linked.':
    'Votre compte va bien — cet appareil est toujours associé.',
  'Create your account first.': 'Créez d’abord votre compte.',
  'Your account is still on this server, but this device was removed from it. Link this device again from one of your devices that still has your account.':
    'Votre compte est toujours sur ce serveur, mais cet appareil en a été retiré. Associez-le à nouveau depuis un de vos appareils qui a encore votre compte.',
  'This server is not accepting new accounts.': 'Ce serveur n’accepte pas de nouveaux comptes.',
  'Your identity already has an account on this server.': 'Votre identité a déjà un compte sur ce serveur.',
  'The server is busy. Try again in a minute.': 'Le serveur est occupé. Réessayez dans une minute.',
  'The server did not recognise this device.': 'Le serveur n’a pas reconnu cet appareil.',
  'The server rejected the request.': 'Le serveur a refusé la demande.',
  'Something went wrong talking to the server.': 'Un problème est survenu en communiquant avec le serveur.',
  'A device is being linked right now. Wait a moment.':
    'Un appareil est en cours d’association. Patientez un instant.',
  'The link code expired. Start again.': 'Le code d’association a expiré. Recommencez.',
  'Something without your code tried to use it. Nothing was linked. Start again.':
    'Quelque chose sans votre code a tenté de l’utiliser. Rien n’a été associé. Recommencez.',
  'This device is already being linked.': 'Cet appareil est déjà en cours d’association.',
  'No device is waiting to be linked.': 'Aucun appareil n’attend d’être associé.',
  'Linking was cancelled.': 'L’association a été annulée.',
  'That device is already linked.': 'Cet appareil est déjà associé.',
  'This is the device you are using.': 'C’est l’appareil que vous utilisez.',
  'There is nothing to link right now.': 'Il n’y a rien à associer pour le moment.',
  'This device already has a River account.': 'Cet appareil a déjà un compte River.',
  'That is not a River link code.': 'Ce n’est pas un code d’association River.',
  'Paste the whole link (it starts with river://) — this code alone does not say which server to use.':
    'Collez le lien entier (il commence par river://) — le code seul n’indique pas quel serveur utiliser.',
  'That link code was already used.': 'Ce code d’association a déjà été utilisé.',
  'That server does not support linking devices yet. Update River on it first.':
    'Ce serveur ne permet pas encore d’associer des appareils. Mettez d’abord River à jour dessus.',
  'The link could not be opened. Start again.': 'Le lien n’a pas pu être ouvert. Recommencez.',
  'The link did not match. Start again.': 'Le lien ne correspondait pas. Recommencez.',
  'That code is for a different account. This device holds the messages of the account it was removed from: link it with a code from a device of that account.':
    'Ce code est pour un autre compte. Cet appareil contient les messages du compte dont il a été retiré : associez-le avec un code d’un appareil de ce compte.',
  'River is locked.': 'River est verrouillé.',
  'Show your recovery phrase and write it down first: without it, no backup can be opened.':
    'Affichez d’abord votre phrase de récupération et notez-la : sans elle, aucune sauvegarde ne peut être ouverte.',
  'This River already has an identity. Restore only works on a fresh install.':
    'Ce River a déjà une identité. La restauration ne fonctionne que sur une nouvelle installation.',
  'This backup was made by a newer River. Update River and try again.':
    'Cette sauvegarde a été faite par un River plus récent. Mettez River à jour et réessayez.',
  'You are banned from this community.': 'Vous êtes banni de cette communauté.',
  'Create an account first.': 'Créez d’abord un compte.',
  "You're offline. River will reconnect by itself.": 'Vous êtes hors ligne. River se reconnectera tout seul.',
  'That is not a valid River invite link.': 'Ce n’est pas un lien d’invitation River valide.',
  'This invite is for a different River server than the one your account is on.':
    'Cette invitation concerne un autre serveur River que celui de votre compte.',
  'This invite has expired or was already used too many times.':
    'Cette invitation a expiré ou a déjà été utilisée trop de fois.',
  'This invite link is damaged: its key does not match the community.':
    'Ce lien d’invitation est endommagé : sa clé ne correspond pas à la communauté.',
  'Only pictures and GIFs can be favourites.': 'Seuls les images et les GIF peuvent être des favoris.',
  'That file is too large to keep as a favourite.':
    'Ce fichier est trop volumineux pour être gardé en favori.',
  'That favourite is gone.': 'Ce favori n’existe plus.',
  'River could not find that message to edit. Scroll to it and try again.':
    'River n’a pas trouvé ce message à modifier. Faites défiler jusqu’à lui et réessayez.',
  'Polls cannot be edited.': 'Les sondages ne peuvent pas être modifiés.',
  'Waiting for the community key…': 'En attente de la clé de la communauté…',
  'That sound no longer exists.': 'Ce son n’existe plus.',
  'That message is no longer here.': 'Ce message n’est plus là.',
  'That emoji no longer exists.': 'Cet emoji n’existe plus.',
  'That event no longer exists.': 'Cet événement n’existe plus.',
  'This file failed its integrity check and was not opened.':
    'Ce fichier a échoué au contrôle d’intégrité et n’a pas été ouvert.',
  'Attachments are not available.': 'Les pièces jointes ne sont pas disponibles.',
  'Signal too large': 'Signal trop volumineux',
  "You're offline": 'Vous êtes hors ligne',
  'Unknown channel': 'Canal inconnu',
  'Unknown community': 'Communauté inconnue',

  'Create your identity first.': 'Créez d’abord votre identité.',
  'You are not in this group.': 'Vous n’êtes pas dans ce groupe.',
  'The message could not be delivered to anyone in the group.':
    'Le message n’a pu être remis à personne dans le groupe.',
  'The server offered an older device list for this person than River has already seen. Messages were not sent.':
    'Le serveur a proposé une liste d’appareils de cette personne plus ancienne que celle déjà vue par River. Les messages n’ont pas été envoyés.',
  'That person has not set up messaging yet.': 'Cette personne n’a pas encore configuré la messagerie.',
  'That person is not on your River server.': 'Cette personne n’est pas sur votre serveur River.',
  'The server offered a different safety key for this person than the one in your shared community. Messages were not sent.':
    'Le serveur a proposé pour cette personne une clé de sécurité différente de celle de votre communauté commune. Les messages n’ont pas été envoyés.',
  'This person’s device list is not signed by their identity key. Messages were not sent.':
    'La liste d’appareils de cette personne n’est pas signée par sa clé d’identité. Les messages n’ont pas été envoyés.',
  'The server returned keys for someone else.': 'Le serveur a renvoyé les clés de quelqu’un d’autre.',
  'That folder is gone.': 'Ce dossier n’existe plus.',
  'That saved reply is gone.': 'Cette réponse enregistrée n’existe plus.',
  'That call is not in a group.': 'Cet appel n’est pas dans un groupe.',
  'That is your own River ID.': 'C’est votre propre River ID.',
  'You can only edit your own messages.': 'Vous ne pouvez modifier que vos propres messages.',
  'That message is gone.': 'Ce message n’existe plus.',
  'You can only delete your own messages for everyone.':
    'Vous ne pouvez supprimer pour tout le monde que vos propres messages.',
  'Choose a time at least a minute from now.': 'Choisissez une heure au moins une minute plus tard.',
  'Choose a time within a year.': 'Choisissez une heure dans l’année qui vient.',
  'You have 100 messages waiting already.': 'Vous avez déjà 100 messages en attente.',
  'You can set a timer once you are friends.': 'Vous pourrez définir un minuteur une fois amis.',
  'Send a message first to set up encryption.': 'Envoyez d’abord un message pour configurer le chiffrement.',
  'The safety number changed while it was on screen. Compare the new number before verifying.':
    'Le numéro de sécurité a changé pendant qu’il était affiché. Comparez le nouveau numéro avant de vérifier.',
  'Add at least one other person.': 'Ajoutez au moins une autre personne.',
  'Only group admins can change the group.': 'Seuls les administrateurs du groupe peuvent le modifier.',
  'Use Leave group to leave.': 'Pour partir, utilisez « Quitter le groupe ».',
  'You can only call your contacts.': 'Vous ne pouvez appeler que vos contacts.',
  'Unblock this person to message them.': 'Débloquez cette personne pour lui écrire.',
  'Please check what you entered.': 'Vérifiez ce que vous avez saisi.',
  "Can't reach your River server. Check your internet connection; River keeps trying.":
    'Impossible de joindre votre serveur River. Vérifiez votre connexion Internet ; River continue d’essayer.',
  "You're doing that too fast. Wait a few seconds and try again.":
    'Vous allez trop vite. Attendez quelques secondes et réessayez.',
  "That's too large to send.": 'C’est trop volumineux pour être envoyé.',
  'Your session ended. River is signing you in again; try once more.':
    'Votre session a expiré. River vous reconnecte ; réessayez.',
  'You do not have permission to do that.': 'Vous n’avez pas l’autorisation de faire cela.',
  'That no longer exists.': 'Cela n’existe plus.',
  'Your River server had a problem. Try again in a moment.':
    'Votre serveur River a rencontré un problème. Réessayez dans un instant.',
  'Something went wrong. Check your connection and try again.':
    'Un problème est survenu. Vérifiez votre connexion et réessayez.',
  'This development build does not use River’s server.':
    'Cette version de développement n’utilise pas le serveur de River.',
  'This development build does not use River’s server. Choose “Use a different server”.':
    'Cette version de développement n’utilise pas le serveur de River. Choisissez « Utiliser un autre serveur ».',
  'The downloaded cloudflared did not match the expected fingerprint, so River did not use it.':
    'Le cloudflared téléchargé ne correspondait pas à l’empreinte attendue, River ne l’a donc pas utilisé.',
  'The cloudflared download is larger than expected.':
    'Le téléchargement de cloudflared est plus volumineux que prévu.',
  'Could not unpack cloudflared.': 'Impossible de décompresser cloudflared.',
  'Restarting the community server…': 'Redémarrage du serveur de communautés…',
  'Setting up your public address (one-time download)…':
    'Configuration de votre adresse publique (téléchargement unique)…',
  'Opening your public address…': 'Ouverture de votre adresse publique…',
  'Reconnecting to the internet…': 'Reconnexion à Internet…',
  'Opening your permanent address…': 'Ouverture de votre adresse permanente…',
  'Tailscale is signed in, but your permanent address did not answer.':
    'Tailscale est connecté, mais votre adresse permanente n’a pas répondu.',
  'Tailscale is not installed.': 'Tailscale n’est pas installé.',
  'River could not set up your account. Try again in a moment.':
    'River n’a pas pu configurer votre compte. Réessayez dans un instant.',
  'That file is too large to be a River backup.':
    'Ce fichier est trop volumineux pour être une sauvegarde River.',
  'Your account is fine — nothing to set up again.': 'Votre compte va bien — rien à reconfigurer.',
  'That is not a valid River sign-up link.': 'Ce n’est pas un lien d’inscription River valide.',
  'Unlock River first.': 'Déverrouillez d’abord River.',
  'Something went wrong creating your account.':
    'Un problème est survenu lors de la création de votre compte.',
  'Write an email': 'Écrire un e-mail',
  'Call a number': 'Appeler un numéro',
  'Write to this address in your mail app?': 'Écrire à cette adresse dans votre application de messagerie ?',
  'Call this number with your phone app?': 'Appeler ce numéro avec votre application Téléphone ?',
  'Only do this if you trust the person who sent it.':
    'Ne le faites que si vous faites confiance à la personne qui l’a envoyé.',
  'Open mail app': 'Ouvrir la messagerie',
  Call: 'Appeler',
  'Open link': 'Ouvrir le lien',
  'Open this link in your browser?': 'Ouvrir ce lien dans votre navigateur ?',
  'Links can lead anywhere. Only open it if you trust where it goes.':
    'Les liens peuvent mener n’importe où. Ne l’ouvrez que si vous faites confiance à sa destination.',
  'Encrypted local storage': 'Stockage local chiffré',
  'Active · passphrase': 'Actif · phrase secrète',
  Active: 'Actif',
  'River’s local database is encrypted with SQLCipher (AES-256). Its key is sealed with your passphrase (Argon2id), which River asks for each time it starts.':
    'La base de données locale de River est chiffrée avec SQLCipher (AES-256). Sa clé est scellée par votre phrase secrète (Argon2id), que River demande à chaque démarrage.',
  'River’s local database is encrypted with SQLCipher (AES-256). Its key is protected by {keystore}, so other user accounts on this computer cannot read it.':
    'La base de données locale de River est chiffrée avec SQLCipher (AES-256). Sa clé est protégée par {keystore}, donc les autres comptes de cet ordinateur ne peuvent pas la lire.',
  Unavailable: 'Indisponible',
  'Opening…': 'Ouverture…',
  'River is opening its local database.': 'River ouvre sa base de données locale.',
  Locked: 'Verrouillé',
  'River’s local data stays encrypted until you enter your passphrase.':
    'Les données locales de River restent chiffrées tant que vous n’avez pas saisi votre phrase secrète.',

  'End-to-end encryption': 'Chiffrement de bout en bout',
  'Direct messages and communities': 'Messages privés et communautés',
  'Direct messages and 1:1 call setup use the Signal protocol (libsignal: PQXDH with post-quantum keys and the Double Ratchet), so each message has its own key and past messages stay safe if a key leaks later. Communities encrypt names, messages and call setup with a shared community key (AES-256-GCM) that travels only inside invite links — anyone with an invite link can read the community, and removing someone does not change the key yet. Files use a fresh key each (AES-256-CBC + HMAC-SHA256). Voice, video and screen sharing go directly between participants, encrypted with DTLS-SRTP. The server still sees who messages whom and when.':
    'Les messages privés et l’établissement des appels 1:1 utilisent le protocole Signal (libsignal : PQXDH avec clés post-quantiques et Double Ratchet) : chaque message a sa propre clé et les anciens messages restent protégés si une clé fuit plus tard. Les communautés chiffrent noms, messages et établissement des appels avec une clé de communauté partagée (AES-256-GCM) qui ne circule que dans les liens d’invitation — quiconque a un lien d’invitation peut lire la communauté, et retirer quelqu’un ne change pas encore la clé. Chaque fichier a sa propre clé (AES-256-CBC + HMAC-SHA256). La voix, la vidéo et le partage d’écran passent directement entre participants, chiffrés avec DTLS-SRTP. Le serveur voit toujours qui écrit à qui et quand.',
  Identity: 'Identité',
  'Your identity key was created on this device and its private half never leaves it. Contacts will verify the fingerprint below to make sure they are really talking to you.':
    'Votre clé d’identité a été créée sur cet appareil et sa partie privée ne le quitte jamais. Vos contacts vérifieront l’empreinte ci-dessous pour s’assurer qu’ils parlent bien avec vous.',
  'Not created': 'Non créée',
  'Create your identity to get a fingerprint your contacts can verify.':
    'Créez votre identité pour obtenir une empreinte que vos contacts pourront vérifier.',
  'Server message access': 'Accès du serveur aux messages',
  'None · {host}': 'Aucun · {host}',
  'No server configured': 'Aucun serveur configuré',
  'Your account on {host} holds your River ID, your @username if you chose one, your public keys and your signed device list. Direct messages, community messages, profiles and files reach it only end-to-end encrypted — it passes them on and keeps them for devices that are offline, but cannot read them. It does see who messages whom and when.':
    'Votre compte sur {host} contient votre River ID, votre @nom d’utilisateur si vous en avez choisi un, vos clés publiques et votre liste d’appareils signée. Messages privés, messages de communauté, profils et fichiers ne lui parviennent que chiffrés de bout en bout — il les transmet et les garde pour les appareils hors ligne, mais ne peut pas les lire. Il voit en revanche qui écrit à qui et quand.',
  'River is set to use {host}, but you have no account there yet, so the server holds none of your data.':
    'River est configuré pour utiliser {host}, mais vous n’y avez pas encore de compte : le serveur ne détient donc aucune de vos données.',
  'River is not set to use any server, so no server holds any of your data.':
    'River n’est configuré pour aucun serveur : aucun serveur ne détient vos données.',
  'Update signatures': 'Signatures des mises à jour',
  Enforced: 'Imposées',
  'Updater off in this build': 'Mises à jour désactivées dans cette version',
  'An update is installed only if its release manifest is signed by a River Ed25519 key built into this app and the downloaded file is listed in it.':
    'Une mise à jour n’est installée que si son manifeste est signé par une clé Ed25519 de River intégrée à cette application et que le fichier téléchargé y figure.',
  'Interface sandbox': 'Bac à sable de l’interface',
  'The interface runs in a sandboxed process with a strict content security policy. It has no access to files, keys or the network.':
    'L’interface tourne dans un processus isolé avec une politique de sécurité du contenu stricte. Elle n’a accès ni aux fichiers, ni aux clés, ni au réseau.',
  '{count} · signed list v{version}': '{count} · liste signée v{version}',
  'The device list could not be verified.': 'La liste d’appareils n’a pas pu être vérifiée.',
  'Your devices are listed in a record signed by your identity key. River checks that signature every time it connects, so the server cannot add a device to your account without you noticing.':
    'Vos appareils figurent dans un registre signé par votre clé d’identité. River vérifie cette signature à chaque connexion : le serveur ne peut donc pas ajouter un appareil à votre compte sans que vous le remarquiez.',
  'This device only': 'Cet appareil uniquement',
  'Your device list starts when you create an account. Then you can link your other phones and computers in Settings → Account → Devices; each one is added to a list signed by your identity key.':
    'Votre liste d’appareils commence quand vous créez un compte. Vous pourrez ensuite associer vos autres téléphones et ordinateurs dans Paramètres → Compte → Appareils ; chacun est ajouté à une liste signée par votre clé d’identité.',
  '⚠ This address uses unusual characters that can imitate another site.':
    '⚠ Cette adresse utilise des caractères inhabituels qui peuvent imiter un autre site.',
  '⚠ This link goes to a raw IP address, not a named website.':
    '⚠ Ce lien mène à une adresse IP brute, pas à un site nommé.',
  '⚠ This is a short link: it hides where it really goes.':
    '⚠ C’est un lien raccourci : il cache sa vraie destination.',
  'This link is not encrypted (http).': 'Ce lien n’est pas chiffré (http).',
  Compatible: 'Compatible',
  'This server needs a newer version of River. Update River to use it.':
    'Ce serveur nécessite une version plus récente de River. Mettez River à jour pour l’utiliser.',
  'This server runs an older River protocol than this app supports.':
    'Ce serveur utilise un protocole River plus ancien que celui pris en charge par cette application.',
  'Invalid address': 'Adresse non valide',
  'That address is not a River server.': 'Cette adresse n’est pas un serveur River.',
  'Could not reach the server. Check the address and your connection.':
    'Impossible de joindre le serveur. Vérifiez l’adresse et votre connexion.',
  'The post could not be delivered to anyone. Check your connection and try again.':
    'La publication n’a pu être remise à personne. Vérifiez votre connexion et réessayez.',
  'Your reaction could not be sent. Check your connection and try again.':
    'Votre réaction n’a pas pu être envoyée. Vérifiez votre connexion et réessayez.',
  'Your comment could not be sent. Check your connection and try again.':
    'Votre commentaire n’a pas pu être envoyé. Vérifiez votre connexion et réessayez.',
  'River cannot reach your system keyring to unlock its local data. Unlock or restore your keyring and restart River.':
    'River ne peut pas accéder au trousseau du système pour déverrouiller ses données locales. Déverrouillez ou restaurez votre trousseau et redémarrez River.',
  'Your local River data was created by a newer version of River. Install the latest River to open it.':
    'Vos données River locales ont été créées par une version plus récente de River. Installez la dernière version de River pour les ouvrir.',
  'River could not upgrade its local data. Nothing was changed; a backup was kept. Please report this problem.':
    'River n’a pas pu mettre à niveau ses données locales. Rien n’a été modifié ; une sauvegarde a été conservée. Merci de signaler ce problème.',
  'River could not decrypt its local data with the stored key.':
    'River n’a pas pu déchiffrer ses données locales avec la clé enregistrée.',
  'River could not open its local data.': 'River n’a pas pu ouvrir ses données locales.',
  'River’s local key file is damaged. Your data has not been changed.':
    'Le fichier de clé local de River est endommagé. Vos données n’ont pas été modifiées.',

  Administrator: 'Administrateur',
  'Every permission, in every channel. Grant carefully.':
    'Toutes les autorisations, dans tous les canaux. À accorder avec prudence.',
  'Manage community': 'Gérer la communauté',
  'Rename the community and change its description.': 'Renommer la communauté et modifier sa description.',
  'Manage roles': 'Gérer les rôles',
  'Create and edit roles below their own, and assign them.':
    'Créer et modifier les rôles inférieurs au sien, et les attribuer.',
  'Manage channels': 'Gérer les canaux',
  'Create, rename, reorder, delete channels and set channel permissions.':
    'Créer, renommer, réordonner, supprimer des canaux et définir leurs autorisations.',
  'Kick members': 'Expulser des membres',
  'Remove members (they can rejoin with an invite).':
    'Retirer des membres (ils peuvent revenir avec une invitation).',
  'Ban members': 'Bannir des membres',
  'Remove members and stop them rejoining.': 'Retirer des membres et les empêcher de revenir.',
  'Time out members': 'Exclure temporairement des membres',
  'Stop members below them from talking, reacting and joining voice for a while.':
    'Empêcher pendant un temps les membres inférieurs d’écrire, de réagir et de rejoindre le vocal.',
  'View audit log': 'Voir le journal d’audit',
  'See who changed roles, channels and settings, and who moderated whom.':
    'Voir qui a modifié les rôles, les canaux et les paramètres, et qui a modéré qui.',
  'Create invites': 'Créer des invitations',
  'Make invite links.': 'Créer des liens d’invitation.',
  'View channels': 'Voir les canaux',
  'See channels and read messages.': 'Voir les canaux et lire les messages.',
  'Send messages': 'Envoyer des messages',
  'Post in text channels.': 'Publier dans les canaux textuels.',
  'Send images and files.': 'Envoyer des images et des fichiers.',
  'Add reactions': 'Ajouter des réactions',
  'React to messages.': 'Réagir aux messages.',
  'Mention @everyone': 'Mentionner @everyone',
  'Notify everyone at once.': 'Notifier tout le monde d’un coup.',
  'Manage messages': 'Gérer les messages',
  "Delete other people's messages.": 'Supprimer les messages des autres.',
  'Pin messages': 'Épingler des messages',
  'Pin and unpin messages.': 'Épingler et désépingler des messages.',
  'Connect to voice': 'Se connecter au vocal',
  'Join voice channels.': 'Rejoindre les salons vocaux.',
  Speak: 'Parler',
  'Talk in voice channels.': 'Parler dans les salons vocaux.',
  'Video & screen share': 'Vidéo et partage d’écran',
  'Turn on camera or share a screen in voice.': 'Activer la caméra ou partager un écran dans le vocal.',
  'Mute & deafen members': 'Rendre muets et sourds des membres',
  'Server-mute or server-deafen others in voice.':
    'Rendre muets ou sourds d’autres membres dans le vocal, pour tout le serveur.',
  'Move & disconnect members': 'Déplacer et déconnecter des membres',
  'Move people between voice channels or disconnect them.':
    'Déplacer des personnes entre salons vocaux ou les déconnecter.',
  'Manage events': 'Gérer les événements',
  'Create, edit and cancel scheduled events.': 'Créer, modifier et annuler des événements programmés.',
  'Manage emoji & sounds': 'Gérer les emojis et les sons',
  'Add, rename and remove the community’s custom emoji and soundboard sounds.':
    'Ajouter, renommer et retirer les emojis et sons de la communauté.',
  'Priority speaker': 'Orateur prioritaire',
  'In voice, turn on Priority speaker so everyone else is turned down while they talk.':
    'Dans le vocal, activer Orateur prioritaire pour baisser tous les autres pendant qu’on parle.',
  "Check someone's access here": 'Vérifier l’accès de quelqu’un ici',
  'Member to check': 'Membre à vérifier',
  'Choose a member…': 'Choisissez un membre…',
  can: 'peut',
  "can't": 'ne peut pas',
  'Includes changes you have not saved yet. Click a line to see why.':
    'Inclut les modifications non enregistrées. Cliquez sur une ligne pour voir pourquoi.',
  'Saved.': 'Enregistré.',
  Picture: 'Image',
  'Community picture': 'Image de la communauté',
  'Choose…': 'Choisir…',
  Remove: 'Retirer',
  Banner: 'Bannière',
  'Community banner': 'Bannière de la communauté',
  'That banner is too detailed to keep small; try another picture.':
    'Cette bannière est trop détaillée pour rester légère ; essayez une autre image.',
  'River could not read that picture.': 'River n’a pas pu lire cette image.',
  'Pictures are end-to-end encrypted like the rest of the community.':
    'Les images sont chiffrées de bout en bout comme le reste de la communauté.',
  'They own the community: owners can do everything.':
    'C’est le propriétaire de la communauté : les propriétaires peuvent tout faire.',
  'a role': 'un rôle',
  '@everyone allows it.': '@everyone l’autorise.',
  '@everyone does not allow it.': '@everyone ne l’autorise pas.',
  'Their role {role} allows it.': 'Son rôle {role} l’autorise.',
  'Their role {role} has Administrator, which allows everything.':
    'Son rôle {role} a Administrateur, qui autorise tout.',
  '@everyone has Administrator, which allows everything.': '@everyone a Administrateur, qui autorise tout.',
  'In #{channel}, @everyone is denied it.': 'Dans #{channel}, c’est refusé à @everyone.',
  'In #{channel}, @everyone is allowed it.': 'Dans #{channel}, c’est autorisé pour @everyone.',
  'In #{channel}, their role {role} is denied it.': 'Dans #{channel}, c’est refusé à son rôle {role}.',
  'In #{channel}, their role {role} is allowed it (an allow on a role beats a deny on another).':
    'Dans #{channel}, c’est autorisé pour son rôle {role} (une autorisation sur un rôle l’emporte sur un refus sur un autre).',
  'In #{channel}, their role {role} is allowed it.': 'Dans #{channel}, c’est autorisé pour son rôle {role}.',
  'They have not accepted the rules yet, so they can only read.':
    'Cette personne n’a pas encore accepté les règles : elle peut seulement lire.',
  'They are timed out.': 'Cette personne est exclue temporairement.',
  '#{channel} is an announcement channel: only people who manage messages post there.':
    '#{channel} est un canal d’annonces : seuls ceux qui gèrent les messages y publient.',
  Moderation: 'Modération',
  Channels: 'Canaux',
  'Emoji & sounds': 'Emojis et sons',
  Spam: 'Spam',
  'Harassment or hate': 'Harcèlement ou haine',
  'Inappropriate content': 'Contenu inapproprié',
  'Scam or phishing': 'Arnaque ou hameçonnage',
  'Something else': 'Autre chose',
  'Mute / unmute': 'Couper / activer le micro',
  'Deafen / undeafen': 'Couper / activer le son',
  'Camera on / off': 'Caméra activée / désactivée',
  'Leave voice': 'Quitter le vocal',
  'Quick switcher': 'Navigation rapide',
  'Bigger interface': 'Interface plus grande',
  'Smaller interface': 'Interface plus petite',
  'Normal size': 'Taille normale',
  'Previous channel': 'Canal précédent',
  'Next channel': 'Canal suivant',
  'Previous community': 'Communauté précédente',
  'Next community': 'Communauté suivante',
  'Mark as read / close': 'Marquer comme lu / fermer',
  'Not set': 'Non défini',
  'Chat, memes and a place to hang out.': 'Discussions, mèmes et un endroit pour se retrouver.',
  Gaming: 'Jeux vidéo',
  'Find a squad, share clips, jump into voice.':
    'Trouvez une équipe, partagez des clips, sautez dans le vocal.',
  'Study group': 'Groupe d’étude',
  'Homework help, notes and quiet study rooms.': 'Aide aux devoirs, notes et salles d’étude calmes.',
  'Club or team': 'Club ou équipe',
  'Announcements, events and meetups.': 'Annonces, événements et rencontres.',
  'Start from scratch': 'Partir de zéro',
  'One text and one voice channel.': 'Un canal textuel et un salon vocal.',

  'Delete {name}': 'Supprimer {name}',
  'This permanently deletes the community, its channels and all messages for everyone. This cannot be undone.':
    'Cela supprime définitivement la communauté, ses canaux et tous les messages pour tout le monde. C’est irréversible.',
  'Delete community': 'Supprimer la communauté',
  Icon: 'Icône',
  'Community icon': 'Icône de la communauté',
  Initials: 'Initiales',
  'Icon {emoji}': 'Icône {emoji}',
  'Community name': 'Nom de la communauté',
  Description: 'Description',
  'Names and descriptions are encrypted with the community key; the server cannot read them.':
    'Les noms et descriptions sont chiffrés avec la clé de la communauté ; le serveur ne peut pas les lire.',
  'General permissions': 'Autorisations générales',
  'Membership permissions': 'Autorisations des membres',
  'Text permissions': 'Autorisations textuelles',
  'Voice permissions': 'Autorisations vocales',
  'Advanced permissions': 'Autorisations avancées',
  Permission: 'Autorisation',
  'new role': 'nouveau rôle',
  'Members get every permission from all their roles. Higher roles can manage lower ones. The owner can do everything. Drag roles to reorder them.':
    'Les membres obtiennent toutes les autorisations de tous leurs rôles. Les rôles supérieurs gèrent les inférieurs. Le propriétaire peut tout faire. Faites glisser les rôles pour les réordonner.',
  'Members with this role lose it. This cannot be undone.':
    'Les membres ayant ce rôle le perdent. C’est irréversible.',
  'You can only edit roles below your highest role.':
    'Vous ne pouvez modifier que les rôles inférieurs à votre rôle le plus élevé.',
  'Role name': 'Nom du rôle',
  'Role colour': 'Couleur du rôle',
  'Default colour': 'Couleur par défaut',
  'Colour {hex}': 'Couleur {hex}',
  'Custom colour': 'Couleur personnalisée',
  'Role icon': 'Icône du rôle',
  'Role icon {emoji}, change': 'Icône du rôle {emoji}, changer',
  'Choose a role icon': 'Choisir une icône de rôle',
  'Shown next to the names of people with this role.': 'Affichée à côté du nom des personnes ayant ce rôle.',
  'Allow anyone to @mention this role': 'Autoriser tout le monde à @mentionner ce rôle',
  'Members can ping everyone with this role. People who may mention @everyone can always mention every role.':
    'Les membres peuvent notifier tous ceux qui ont ce rôle. Qui peut mentionner @everyone peut toujours mentionner tous les rôles.',
  'Show members with this role separately': 'Afficher séparément les membres ayant ce rôle',
  'Online members with this role get their own group in the member list.':
    'Les membres en ligne ayant ce rôle ont leur propre groupe dans la liste des membres.',
  '@everyone applies to every member of the community. Use it for the defaults.':
    '@everyone s’applique à tous les membres de la communauté. Utilisez-le pour les réglages par défaut.',
  '{name} (copy)': '{name} (copie)',
  'Made a copy of {name}.': 'Copie de {name} créée.',
  'Duplicate role': 'Dupliquer le rôle',
  'Members — {count}': 'Membres — {count}',
  'Search members': 'Rechercher des membres',
  'Change roles of selected members': 'Modifier les rôles des membres sélectionnés',
  '{count} selected': '{count} sélectionné(s)',
  'Give a role to the selected members': 'Donner un rôle aux membres sélectionnés',
  'Give role…': 'Donner un rôle…',
  'Remove a role from the selected members': 'Retirer un rôle aux membres sélectionnés',
  'Remove role…': 'Retirer un rôle…',
  Clear: 'Effacer',
  'Select {name}': 'Sélectionner {name}',
  'Remove {role} from {name}': 'Retirer {role} à {name}',
  'Add role to {name}': 'Ajouter un rôle à {name}',
  '+ Role': '+ Rôle',
  'Kick {name}': 'Expulser {name}',
  '{name} will be removed. They can rejoin with a new invite.':
    '{name} sera retiré(e). Il ou elle pourra revenir avec une nouvelle invitation.',
  Kick: 'Expulser',
  Ban: 'Bannir',
  'Nobody is banned.': 'Personne n’est banni.',
  'Banned on {date}': 'Banni le {date}',
  'until {time}': 'jusqu’au {time}',
  'Revoke ban': 'Lever le bannissement',
  'Changes to roles, channels and settings, and moderation, for the last 90 days. The server keeps only IDs; names are filled in on your computer.':
    'Modifications des rôles, des canaux et des paramètres, et modération, sur les 90 derniers jours. Le serveur ne garde que des ID ; les noms sont complétés sur votre ordinateur.',
  'Kind of change': 'Type de modification',
  Everything: 'Tout',
  Who: 'Qui',
  Anyone: 'N’importe qui',
  'Search the audit log': 'Rechercher dans le journal d’audit',
  Copy: 'Copier',
  'Nothing has happened yet.': 'Il ne s’est encore rien passé.',
  'Nothing matches.': 'Aucun résultat.',
  'Load older': 'Charger plus anciens',
  'For good': 'Définitivement',
  'For 1 hour': 'Pendant 1 heure',
  'For 1 day': 'Pendant 1 jour',
  'For 1 week': 'Pendant 1 semaine',
  'For 30 days': 'Pendant 30 jours',
  "Don't delete any": 'N’en supprimer aucun',
  'From the last hour': 'De la dernière heure',
  'From the last 6 hours': 'Des 6 dernières heures',
  'From the last 24 hours': 'Des dernières 24 heures',
  'From the last 3 days': 'Des 3 derniers jours',
  'From the last 7 days': 'Des 7 derniers jours',
  '{name} was banned.': '{name} a été banni(e).',
  'Ban {name}': 'Bannir {name}',
  '{name} will be removed from {community} and cannot rejoin until the ban ends or someone unbans them.':
    '{name} sera retiré(e) de {community} et ne pourra pas revenir avant la fin du bannissement ou sa levée.',
  '{name} will be removed from the community and cannot rejoin until the ban ends or someone unbans them.':
    '{name} sera retiré(e) de la communauté et ne pourra pas revenir avant la fin du bannissement ou sa levée.',
  'How long': 'Durée',
  'Delete their messages': 'Supprimer ses messages',
  'Invite friends to {name}': 'Inviter des amis dans {name}',
  'Send this link privately. Anyone with it can join and read this community. It works 100 times and expires in 7 days.':
    'Envoyez ce lien en privé. Quiconque l’a peut rejoindre et lire cette communauté. Il fonctionne 100 fois et expire dans 7 jours.',
  'Creating link…': 'Création du lien…',
  'Copied ✓': 'Copié ✓',
  'Copy link': 'Copier le lien',
  'Channel type': 'Type de canal',
  Text: 'Textuel',
  Voice: 'Vocal',
  Forum: 'Forum',
  Stage: 'Scène',
  'Messages, emoji, opinions and puns': 'Messages, emojis, avis et jeux de mots',
  'Hang out with voice, video and screen share': 'Se retrouver en vocal, vidéo et partage d’écran',
  'Organised posts with titles and tags, each with its own replies':
    'Publications organisées avec titres et tags, chacune avec ses réponses',
  'Talks and events: speakers on stage, everyone else listens':
    'Conférences et événements : des orateurs sur scène, les autres écoutent',
  'Channel name': 'Nom du canal',
  'new-channel': 'nouveau-canal',
  'Private channel': 'Canal privé',
  'Only selected roles (and admins) will be able to see this channel.':
    'Seuls les rôles choisis (et les administrateurs) pourront voir ce canal.',
  'Category name': 'Nom de la catégorie',
  'New category': 'Nouvelle catégorie',
  'Category names are encrypted like channel names. Drag channels onto a category to move them.':
    'Les noms de catégorie sont chiffrés comme ceux des canaux. Faites glisser des canaux sur une catégorie pour les déplacer.',
  'Category settings': 'Paramètres de la catégorie',
  Permissions: 'Autorisations',
  "Its channels stay and move out of the category. Channels synced to it keep the category's permissions as their own, so private channels stay private.":
    'Ses canaux restent et sortent de la catégorie. Les canaux synchronisés gardent les autorisations de la catégorie comme les leurs : les canaux privés restent privés.',
  'Delete category': 'Supprimer la catégorie',
  'Category permissions': 'Autorisations de la catégorie',
  'Channels you add to this category follow these permissions until you give them their own.':
    'Les canaux ajoutés à cette catégorie suivent ces autorisations jusqu’à ce que vous leur en donniez des propres.',
  Off: 'Désactivé',
  '5 seconds': '5 secondes',
  '10 seconds': '10 secondes',
  '30 seconds': '30 secondes',
  '1 minute': '1 minute',
  '2 minutes': '2 minutes',
  '5 minutes': '5 minutes',
  '10 minutes': '10 minutes',
  '2 hours': '2 heures',
  '6 hours': '6 heures',
  'Channel settings': 'Paramètres du canal',
  'This deletes the channel and all of its messages for everyone. This cannot be undone.':
    'Cela supprime le canal et tous ses messages pour tout le monde. C’est irréversible.',
  'Delete channel': 'Supprimer le canal',
  'Channel topic': 'Sujet du canal',
  'Let everyone know how to use this channel!': 'Expliquez à tous comment utiliser ce canal !',
  'Age-restricted (18+)': 'Réservé aux adultes (18+)',
  'People confirm they are 18 or older before opening this channel.':
    'Les personnes confirment avoir 18 ans ou plus avant d’ouvrir ce canal.',
  'Media channel': 'Canal multimédia',
  'Opens as a gallery of the pictures and videos shared here; the chat is one click away.':
    'S’ouvre comme une galerie des images et vidéos partagées ici ; la discussion est à un clic.',
  'Every message starts a post with a title and its own replies, shown as a list of posts.':
    'Chaque message ouvre une publication avec un titre et ses propres réponses, affichées en liste de publications.',
  'Announcement channel': 'Canal d’annonces',
  'Only people who can manage messages post here; everyone else reads and reacts.':
    'Seuls ceux qui gèrent les messages publient ici ; les autres lisent et réagissent.',
  Slowmode: 'Mode lent',
  'How long members wait between messages. People who manage messages are not slowed down.':
    'Délai entre deux messages pour les membres. Ceux qui gèrent les messages ne sont pas ralentis.',
  'For talks and events: people join as listeners, raise a hand to ask to speak, and moderators invite speakers.':
    'Pour conférences et événements : on entre en tant qu’auditeur, on lève la main pour demander la parole, et les modérateurs invitent les orateurs.',
  'User limit': 'Limite d’utilisateurs',
  'No limit': 'Aucune limite',
  'People who can move members can always join.':
    'Ceux qui peuvent déplacer des membres peuvent toujours rejoindre.',
  Category: 'Catégorie',
  'No category': 'Aucune catégorie',
  Order: 'Ordre',
  'Move up': 'Monter',
  'Move down': 'Descendre',
  'Channel permissions': 'Autorisations du canal',
  'Override what each role can do in this channel only.':
    'Modifiez ce que chaque rôle peut faire dans ce canal uniquement.',
  "Synced with {category}: this channel uses the category's permissions. Changing them here gives the channel its own.":
    'Synchronisé avec {category} : ce canal utilise les autorisations de la catégorie. Les modifier ici lui en donne des propres.',
  'This channel has its own permissions, not those of {category}.':
    'Ce canal a ses propres autorisations, pas celles de {category}.',
  'Sync with category': 'Synchroniser avec la catégorie',
  'Hide this channel from @everyone. Then allow the roles that should see it.':
    'Masquez ce canal à @everyone. Autorisez ensuite les rôles qui doivent le voir.',
  'Picture set for this community.': 'Image définie pour cette communauté.',
  'Back to your usual picture here.': 'Retour à votre image habituelle ici.',
  'Picture in this community': 'Image dans cette communauté',
  'Your usual picture': 'Votre image habituelle',
  'Use my usual picture': 'Utiliser mon image habituelle',
  'Nickname in {name}': 'Pseudo dans {name}',
  Nickname: 'Pseudo',
  'Your River name': 'Votre nom River',
  'Only members of this community see it. It is encrypted like the rest of your profile.':
    'Seuls les membres de cette communauté le voient. Il est chiffré comme le reste de votre profil.',
  'Reset to my River name': 'Revenir à mon nom River',

  'Everyone here can use these with {code} in messages and reactions. Click a name to rename it. Pictures and names are end-to-end encrypted. Up to 100.':
    'Tout le monde ici peut les utiliser avec {code} dans les messages et réactions. Cliquez sur un nom pour le renommer. Images et noms sont chiffrés de bout en bout. Jusqu’à 100.',
  'Upload emoji': 'Importer un emoji',
  'That image is too large.': 'Cette image est trop volumineuse.',
  'River could not read that image.': 'River n’a pas pu lire cette image.',
  Name: 'Nom',
  '2–32 letters, numbers or _': '2 à 32 lettres, chiffres ou _',
  Add: 'Ajouter',
  'No custom emoji yet.': 'Pas encore d’emoji personnalisé.',
  'New name for :{name}:': 'Nouveau nom pour :{name}:',
  Rename: 'Renommer',
  'Remove :{name}:': 'Retirer :{name}:',
  channel: 'canal',
  'Someone who left': 'Quelqu’un qui est parti',
  'Copied.': 'Copié.',
  'Counted on your device from messages you can read; the server cannot see them, so it cannot count them.':
    'Compté sur votre appareil à partir des messages que vous pouvez lire ; le serveur ne les voit pas, il ne peut donc pas les compter.',
  members: 'membres',
  'online now': 'en ligne',
  'joined this week': 'arrivés cette semaine',
  'Messages per day': 'Messages par jour',
  Period: 'Période',
  'Some busy channels have more history than River counted.':
    'Certains canaux très actifs ont plus d’historique que ce que River a compté.',
  'Busiest channels': 'Canaux les plus actifs',
  'No messages yet.': 'Pas encore de messages.',
  'Most active people': 'Personnes les plus actives',
  'Counting…': 'Comptage…',
  'New members per week': 'Nouveaux membres par semaine',
  'New members per week, last 8 weeks': 'Nouveaux membres par semaine, 8 dernières semaines',
  'Active invite links, who made them and who joined with them. Revoking stops a link from working; people who already joined stay.':
    'Liens d’invitation actifs, leurs créateurs et ceux qui les ont utilisés. Révoquer un lien le désactive ; les personnes déjà arrivées restent.',
  'No active invites.': 'Aucune invitation active.',
  '{uses} of {max} uses': '{uses} utilisations sur {max}',
  'expires {date}': 'expire le {date}',
  'made {date}': 'créée le {date}',
  'Joined with it: {names}': 'L’ont utilisé : {names}',
  Revoke: 'Révoquer',
  'Members · {count}': 'Membres · {count}',
  'Close members': 'Fermer les membres',
  'Community owner': 'Propriétaire de la communauté',
  '{name} will be removed from {community}. They can rejoin with a new invite.':
    '{name} sera retiré(e) de {community}. Il ou elle pourra revenir avec une nouvelle invitation.',
  '{name} will be removed from {community} and cannot rejoin until unbanned.':
    '{name} sera retiré(e) de {community} et ne pourra pas revenir avant la levée du bannissement.',
  'Timed out until {time}': 'Exclu(e) jusqu’au {time}',
  'Copy River ID': 'Copier le River ID',
  'River ID copied.': 'River ID copié.',
  'Copy ID': 'Copier l’ID',
  'Member of {community} since {date}': 'Membre de {community} depuis le {date}',
  'About me': 'À propos de moi',
  'Until {time}': 'Jusqu’au {time}',
  'Remove {name}': 'Retirer {name}',
  'Add role': 'Ajouter un rôle',
  'No roles': 'Aucun rôle',
  For: 'Pendant',
  Good: 'Toujours',
  '1 day': '1 jour',
  '1 week': '1 semaine',
  '30 days': '30 jours',
  'User volume': 'Volume de l’utilisateur',
  'Volume for {name}': 'Volume de {name}',
  'Server unmute': 'Réactiver le micro (serveur)',
  'Server mute': 'Couper le micro (serveur)',
  'Server undeafen': 'Réactiver le son (serveur)',
  'Server deafen': 'Couper le son (serveur)',
  'Move {name} to another voice channel': 'Déplacer {name} vers un autre salon vocal',
  'Move to…': 'Déplacer vers…',
  'Make {name} the owner?': 'Faire de {name} le propriétaire ?',
  '{name} will own {community} and can do everything, including deleting it. You become an ordinary member with the roles you have. Only they can hand it back.':
    '{name} deviendra propriétaire de {community} et pourra tout faire, y compris la supprimer. Vous deviendrez un membre ordinaire avec vos rôles. Seule cette personne pourra vous la rendre.',
  'Transfer ownership': 'Transférer la propriété',
  'You are friends': 'Vous êtes amis',
  'Friends ✓': 'Amis ✓',
  'Wants to be friends': 'Veut devenir votre ami',
  'Request sent ✓': 'Demande envoyée ✓',
  'Friend request sent': 'Demande d’ami envoyée',
  'Add friend': 'Ajouter un ami',
  '60 seconds': '60 secondes',
  '{name} is timed out': '{name} est exclu(e) temporairement',
  'Timeout ended for {name}': 'Exclusion temporaire terminée pour {name}',
  'End timeout': 'Lever l’exclusion',
  'Time out': 'Exclure temporairement',
  'Timeout length': 'Durée de l’exclusion',
  'Moderator notes · only moderators see these':
    'Notes de modération · visibles seulement par les modérateurs',
  'Remove note': 'Retirer la note',
  'Add a note': 'Ajouter une note',
  'Add a moderator note': 'Ajouter une note de modération',
  'What new members see first. Rules and the welcome note are end-to-end encrypted.':
    'Ce que les nouveaux membres voient en premier. Les règles et le mot d’accueil sont chiffrés de bout en bout.',
  'Welcome note': 'Mot d’accueil',
  "Glad you're here! Start in #general and say hi.":
    'Ravi de vous voir ! Commencez dans #general et dites bonjour.',
  Rules: 'Règles',
  'Add a rule (e.g. Be kind)': 'Ajouter une règle (ex. Soyez bienveillants)',
  'New rule': 'Nouvelle règle',
  'New members must accept the rules': 'Les nouveaux membres doivent accepter les règles',
  'Until they do, they can read but not post, react or join voice. People already here are not asked.':
    'En attendant, ils peuvent lire mais pas publier, réagir ni rejoindre le vocal. Les membres déjà présents ne sont pas sollicités.',
  'Roles members can pick themselves': 'Rôles que les membres peuvent choisir',
  'Create a role (for example "Gamer") to offer it here.':
    'Créez un rôle (par exemple « Gamer ») pour le proposer ici.',
  "can moderate, so it can't be self-assigned": 'peut modérer, donc ne peut pas être choisi soi-même',
  'Word filter saved.': 'Filtre de mots enregistré.',
  'Word filter turned off.': 'Filtre de mots désactivé.',
  'Word filter': 'Filtre de mots',
  'One word or phrase per line. Matching ignores case, accents and look-alikes like 4 for a. Your server cannot read messages, so every River app applies the filter itself — a modified app could ignore it. People who manage messages always see everything.':
    'Un mot ou une expression par ligne. La correspondance ignore la casse, les accents et les sosies comme 4 pour a. Votre serveur ne peut pas lire les messages : chaque application River applique le filtre elle-même — une application modifiée pourrait l’ignorer. Ceux qui gèrent les messages voient toujours tout.',
  'Filtered words': 'Mots filtrés',
  'Hide messages with these words (members can still show them)':
    'Masquer les messages contenant ces mots (les membres peuvent quand même les afficher)',
  'Also stop people from sending them': 'Et empêcher aussi leur envoi',
  'Save filter': 'Enregistrer le filtre',
  'Turn off filter': 'Désactiver le filtre',
  'Welcome to {name}!': 'Bienvenue dans {name} !',
  'Rules of {name}': 'Règles de {name}',
  'Welcome to {name}': 'Bienvenue dans {name}',
  'Before you join in, please read the rules:': 'Avant de participer, lisez les règles :',
  "This community asks new members to agree to its rules before joining in. Its rules could not be shown here; by continuing you agree to follow them and the moderators' guidance.":
    'Cette communauté demande aux nouveaux membres d’accepter ses règles avant de participer. Elles n’ont pas pu être affichées ici ; en continuant, vous acceptez de les suivre ainsi que les consignes des modérateurs.',
  "I've read and agree to the rules": 'J’ai lu et j’accepte les règles',
  'Join the conversation': 'Rejoindre la conversation',
  'Choose what fits you. You can change it any time from the community menu.':
    'Choisissez ce qui vous correspond. Vous pourrez le changer à tout moment depuis le menu de la communauté.',
  Skip: 'Passer',

  'That is a link code for a new device. Open it on the device you are adding, on its welcome screen.':
    'C’est un code d’association pour un nouvel appareil. Ouvrez-le sur l’appareil que vous ajoutez, depuis son écran d’accueil.',
  'That friend link is not complete. Ask for a new one, or add them by @username.':
    'Ce lien d’ami est incomplet. Demandez-en un nouveau ou ajoutez la personne par son @nom d’utilisateur.',
  'That sign-up link is for a new account — you already have one.':
    'Ce lien d’inscription sert à créer un compte — vous en avez déjà un.',
  'Join this community?': 'Rejoindre cette communauté ?',
  "You've been invited to a River community. Joining shares your River name and avatar with its members.":
    'Vous êtes invité dans une communauté River. En la rejoignant, vous partagez votre nom et votre avatar River avec ses membres.',
  'Not now': 'Pas maintenant',
  'Join community': 'Rejoindre la communauté',
  'Create your account here?': 'Créer votre compte ici ?',
  'This link would create your River account on {host}. That server will know your River ID and which devices you use, never your messages. Continue only if you trust whoever sent you this link.':
    'Ce lien créerait votre compte River sur {host}. Ce serveur connaîtra votre River ID et les appareils que vous utilisez, jamais vos messages. Ne continuez que si vous faites confiance à la personne qui vous l’a envoyé.',
  'This sign-up link is not valid.': 'Ce lien d’inscription n’est pas valide.',
  'Your account is ready': 'Votre compte est prêt',
  'Creating…': 'Création…',
  'Create account': 'Créer un compte',
  'You need an account first: join or create a community.':
    'Il vous faut d’abord un compte : rejoignez ou créez une communauté.',
  "That's your own friend link.": 'C’est votre propre lien d’ami.',
  'Add a friend?': 'Ajouter un ami ?',
  'This is a River friend link.': 'C’est un lien d’ami River.',
  'You pasted a River ID.': 'Vous avez collé un River ID.',
  'River will send them “{greeting}” as an end-to-end encrypted request.':
    'River lui enverra « {greeting} » sous forme de demande chiffrée de bout en bout.',
  'Setting up your account… The button works as soon as it is ready.':
    'Configuration de votre compte… Le bouton fonctionnera dès qu’il sera prêt.',
  'You are already friends': 'Vous êtes déjà amis',
  'Send friend request': 'Envoyer une demande d’ami',
  Deny: 'Refuser',
  Inherit: 'Hériter',
  'Inherit from roles': 'Hériter des rôles',
  Allow: 'Autoriser',
  'You can only allow permissions you have yourself':
    'Vous ne pouvez autoriser que les autorisations que vous avez vous-même',
  "Thanks — {name}'s moderators will take a look.": 'Merci — les modérateurs de {name} vont regarder.',
  'An attachment': 'Une pièce jointe',
  'What is wrong with it?': 'Quel est le problème ?',
  'Anything to add? (optional)': 'Quelque chose à ajouter ? (facultatif)',
  'Only people who moderate messages in {name} see reports — never River or the server operator. They see who reported and a copy of the message, encrypted like everything else here.':
    'Seules les personnes qui modèrent les messages dans {name} voient les signalements — jamais River ni l’opérateur du serveur. Elles voient qui a signalé et une copie du message, chiffrée comme tout le reste ici.',
  Report: 'Signaler',
  Open: 'Ouverts',
  Resolved: 'Résolus',
  Dismissed: 'Rejetés',
  'Messages members reported. Each shows the message as the reporter saw it; open the original to check it. Handling a report is recorded in the audit log.':
    'Messages signalés par les membres. Chacun montre le message tel que l’auteur du signalement l’a vu ; ouvrez l’original pour vérifier. Le traitement d’un signalement est consigné dans le journal d’audit.',
  'Which reports': 'Quels signalements',
  'Open ({count})': 'Ouverts ({count})',
  'Nothing to review. 🎉': 'Rien à examiner. 🎉',
  'No reports yet.': 'Pas encore de signalement.',
  '{reporter} reported {name} in #{channel}': '{reporter} a signalé {name} dans #{channel}',
  'Resolved by {name}': 'Résolu par {name}',
  'Dismissed by {name}': 'Rejeté par {name}',
  'Open message': 'Ouvrir le message',
  Resolve: 'Résoudre',
  Reopen: 'Rouvrir',
  'You cannot speak in this channel': 'Vous ne pouvez pas parler dans ce canal',
  'Click to play for everyone · right-click to preview':
    'Cliquez pour jouer pour tous · clic droit pour écouter',
  'No sounds yet.': 'Pas encore de sons.',
  'Add some': 'En ajouter',
  'Sounds can be up to {size} KB.': 'Les sons peuvent faire jusqu’à {size} Ko.',
  'Sounds can be up to {seconds} seconds long.': 'Les sons peuvent durer jusqu’à {seconds} secondes.',
  'Use an MP3, OGG, WAV or WebM file.': 'Utilisez un fichier MP3, OGG, WAV ou WebM.',
  'River could not read that sound.': 'River n’a pas pu lire ce son.',
  'Short sounds anyone who may speak can play in voice channels; pick one as your entrance sound. Sounds are end-to-end encrypted. Up to 48, each up to {seconds} seconds.':
    'Des sons courts que toute personne autorisée à parler peut jouer dans les salons vocaux ; choisissez-en un comme son d’entrée. Les sons sont chiffrés de bout en bout. Jusqu’à 48, de {seconds} secondes maximum chacun.',
  'Upload sound': 'Importer un son',
  'Choose an emoji for this sound': 'Choisir un emoji pour ce son',
  Preview: 'Écouter',
  'Emoji for {name}': 'Emoji de {name}',
  'New name for {name}': 'Nouveau nom pour {name}',
  'Preview {name}': 'Écouter {name}',
  'Plays for everyone when you join a voice channel here':
    'Joué pour tous quand vous rejoignez un salon vocal ici',
  'Your entrance sound': 'Votre son d’entrée',
  'Use as entrance': 'Utiliser en entrée',
  'Setting up your account and your community…': 'Configuration de votre compte et de votre communauté…',
  '{name} is ready': '{name} est prête',
  'Bring your people together': 'Rassemblez vos proches',
  'Private spaces with text, voice and video — encrypted with a key only members have.':
    'Des espaces privés avec texte, voix et vidéo — chiffrés avec une clé que seuls les membres possèdent.',
  'Got an invite?': 'Vous avez une invitation ?',
  'Invite link': 'Lien d’invitation',
  'River sets everything up, including your account.': 'River configure tout, y compris votre compte.',
  'Or start your own': 'Ou créez la vôtre',
  'Community template': 'Modèle de communauté',
  '{template} channels': 'Canaux : {template}',
  'e.g. The Crew': 'ex. La Bande',
  'Server address': 'Adresse du serveur',
  'Create community': 'Créer la communauté',
  'Use River’s server': 'Utiliser le serveur de River',
  'Use a different server': 'Utiliser un autre serveur',
  'Back to my communities': 'Retour à mes communautés',
  '[a sticker that is no longer here]': '[un sticker qui n’existe plus]',
  'Sticker: {name}': 'Sticker : {name}',
  'Search stickers': 'Rechercher des stickers',
  'Stickers come from your communities. Join or make one to add stickers.':
    'Les stickers viennent de vos communautés. Rejoignez-en ou créez-en une pour en ajouter.',
  'No stickers yet. Community admins add them in community settings → Stickers.':
    'Pas encore de stickers. Les administrateurs les ajoutent dans Paramètres de la communauté → Stickers.',
  'Send sticker {name}': 'Envoyer le sticker {name}',
  'No stickers here yet.': 'Pas encore de stickers ici.',
  'Big pictures anyone here can send with the 🗒️ button. End-to-end encrypted. Up to 60.':
    'De grandes images que chacun ici peut envoyer avec le bouton 🗒️. Chiffrées de bout en bout. Jusqu’à 60.',
  'Upload sticker': 'Importer un sticker',
  'River could not make a sticker from that picture (try a smaller one).':
    'River n’a pas pu faire un sticker avec cette image (essayez-en une plus petite).',
  'No stickers yet.': 'Pas encore de stickers.',
  'Remove sticker {name}': 'Retirer le sticker {name}',

  'Profile saved': 'Profil enregistré',
  'Preview of your profile card': 'Aperçu de votre carte de profil',
  'Change avatar': 'Changer d’avatar',
  'Display name (optional)': 'Nom affiché (facultatif)',
  Pronouns: 'Pronoms',
  'she/her, they/them…': 'elle, il, iel…',
  'A little about you': 'Quelques mots sur vous',
  'Banner colour': 'Couleur de la bannière',
  'No banner colour': 'Pas de couleur de bannière',
  'Banner colour {hex}': 'Couleur de bannière {hex}',
  'Your profile is encrypted separately for each community you are in; the server only stores ciphertext. About me is also your bio on your social profile.':
    'Votre profil est chiffré séparément pour chaque communauté dont vous faites partie ; le serveur ne stocke que du texte chiffré. « À propos de moi » est aussi votre bio sur votre profil social.',
  'River ID': 'River ID',
  '` (backtick)': '` (accent grave)',
  'Input device': 'Périphérique d’entrée',
  Default: 'Par défaut',
  Microphone: 'Microphone',
  'Output device': 'Périphérique de sortie',
  Speakers: 'Haut-parleurs',
  "Let's check": 'Tester',
  'Stop testing': 'Arrêter le test',
  'Microphone level': 'Niveau du micro',
  'Input mode': 'Mode d’entrée',
  'Voice activity': 'Détection de la voix',
  'Set input sensitivity automatically': 'Régler la sensibilité automatiquement',
  'River sends your voice all the time and filters noise. Turn off to choose how loud you must be.':
    'River envoie votre voix en continu et filtre le bruit. Désactivez pour choisir à quel volume vous devez parler.',
  'Input sensitivity': 'Sensibilité d’entrée',
  "Your voice is sent while the meter is past the line (it turns green). Press Let's check to see it.":
    'Votre voix est envoyée tant que l’indicateur dépasse la ligne (il passe au vert). Appuyez sur « Tester » pour le voir.',
  Shortcut: 'Raccourci',
  'Press a key…': 'Appuyez sur une touche…',
  'Push to talk works while the River window is focused.':
    'Le push-to-talk fonctionne quand la fenêtre de River est active.',
  'Voice volume · {percent}%': 'Volume des voix · {percent} %',
  'How loud everyone sounds in calls and voice channels. Above 100% River boosts the sound and keeps it from distorting.':
    'Le volume de tout le monde en appel et en vocal. Au-delà de 100 %, River amplifie le son sans le distordre.',
  'Soundboard volume': 'Volume de la table de sons',
  "How loud other people's soundboard sounds play for you (0 turns them off).":
    'Le volume auquel vous entendez les sons des autres (0 les coupe).',
  "Leave voice when you're alone": 'Quitter le vocal quand vous êtes seul',
  Never: 'Jamais',
  'After 5 minutes': 'Après 5 minutes',
  'After 15 minutes': 'Après 15 minutes',
  'After 30 minutes': 'Après 30 minutes',
  'After an hour': 'Après une heure',
  'Voice processing': 'Traitement de la voix',
  'Noise suppression': 'Suppression du bruit',
  'Filters background noise like fans and keyboards.':
    'Filtre les bruits de fond comme les ventilateurs et les claviers.',
  'Echo cancellation': 'Annulation de l’écho',
  'Stops others hearing themselves through your speakers.':
    'Évite que les autres s’entendent à travers vos haut-parleurs.',
  'Keyboard shortcuts': 'Raccourcis clavier',
  'Desktop notifications': 'Notifications de bureau',
  'Shown when River is in the background.': 'Affichées quand River est en arrière-plan.',
  'Banners inside River': 'Bannières dans River',
  'While River is open, a small banner shows new messages from other chats and channels. Tap it to open the chat. Muted chats stay quiet.':
    'Quand River est ouvert, une petite bannière affiche les nouveaux messages des autres discussions et canaux. Touchez-la pour ouvrir la discussion. Les discussions en sourdine restent silencieuses.',
  'Unread count on River’s icon': 'Compteur de non-lus sur l’icône de River',
  'The number of unread messages and mentions on River’s taskbar or dock icon (and the iPhone’s app icon). Muted chats are not counted. On Android the launcher shows it from River’s notifications.':
    'Le nombre de messages et de mentions non lus sur l’icône de River dans la barre des tâches ou le Dock (et sur l’icône de l’app sur iPhone). Les discussions en sourdine ne comptent pas. Sur Android, le lanceur l’affiche à partir des notifications de River.',
  'Count archived chats': 'Compter les discussions archivées',
  'Unread messages in archived chats count on the Chats and Home badges and on River’s icon. Off: archived chats wait quietly in Archived. Message requests are never counted.':
    'Les messages non lus des discussions archivées comptent sur les pastilles Discussions et Accueil et sur l’icône de River. Désactivé : les discussions archivées attendent discrètement dans Archives. Les demandes de message ne comptent jamais.',
  'Reactions to my messages': 'Réactions à mes messages',
  'A sound and a small notice when someone reacts to something you wrote (while that channel is loaded).':
    'Un son et une petite notification quand quelqu’un réagit à ce que vous avez écrit (tant que ce canal est chargé).',
  'Notify me about': 'Me notifier pour',
  'All messages': 'Tous les messages',
  'Only @mentions': 'Seulement les @mentions',
  Sounds: 'Sons',
  'Short sounds for messages, voice, calls, friends and the interface.':
    'Des sons courts pour les messages, le vocal, les appels, les amis et l’interface.',
  'Sound volume — {percent}%': 'Volume des sons — {percent} %',
  'Play the {sound} sound': 'Jouer le son « {sound} »',
  'Sending, receiving, mentions, direct messages and reactions.':
    'Envoi, réception, mentions, messages privés et réactions.',
  Send: 'Envoi',
  Mention: 'Mention',
  'Direct message': 'Message privé',
  Reaction: 'Réaction',
  'Voice channels': 'Salons vocaux',
  'Joining, leaving, mute, deafen, push-to-talk and screen sharing.':
    'Arrivée, départ, micro coupé, son coupé, push-to-talk et partage d’écran.',
  'You join': 'Vous arrivez',
  'Someone joins': 'Quelqu’un arrive',
  'Someone leaves': 'Quelqu’un part',
  'Go live': 'Passer en direct',
  'Push-to-talk': 'Push-to-talk',
  'Ringing, connected and call ended.': 'Sonnerie, connexion et fin d’appel.',
  Ringing: 'Sonnerie',
  Ended: 'Terminé',
  'Friends and communities': 'Amis et communautés',
  'Friend requests, new friends and joining a community.':
    'Demandes d’ami, nouveaux amis et arrivée dans une communauté.',
  'Friend request': 'Demande d’ami',
  'New friend': 'Nouvel ami',
  'Joined a community': 'Communauté rejointe',
  Interface: 'Interface',
  'Copied, saved and something went wrong.': 'Copié, enregistré et un problème est survenu.',
  Done: 'Terminé',
  Error: 'Erreur',
  'Use Ctrl or Alt with a key (or an F key), so typing never sets it off.':
    'Utilisez Ctrl ou Alt avec une touche (ou une touche F) pour que la saisie ne le déclenche jamais.',
  '{shortcut} is already used for {action}.': '{shortcut} est déjà utilisé pour « {action} ».',
  '{action}: {shortcut}. Click to change.': '{action} : {shortcut}. Cliquez pour changer.',
  'Press keys…': 'Appuyez sur les touches…',
  'Restore defaults': 'Rétablir les valeurs par défaut',
  'Shortcuts work while River is focused. Press Esc to stop changing one.':
    'Les raccourcis fonctionnent quand River est actif. Appuyez sur Échap pour arrêter d’en modifier un.',
  'deleted channel': 'canal supprimé',
  'Let a script or another service post into a channel. It encrypts each post itself with a key that is only in the webhook address, so the server still cannot read it. Anyone with the address can post as the webhook (not read), so keep it secret.':
    'Laissez un script ou un autre service publier dans un canal. Il chiffre lui-même chaque publication avec une clé contenue uniquement dans l’adresse du webhook : le serveur ne peut toujours pas la lire. Quiconque a l’adresse peut publier en tant que webhook (sans lire), gardez-la donc secrète.',
  'Copy this address now — River will not show it again.':
    'Copiez cette adresse maintenant — River ne la montrera plus.',
  Copied: 'Copié',
  'Post with {script} from the River repository, or any tool that follows ADR 0004.':
    'Publiez avec {script} du dépôt River, ou tout outil qui suit l’ADR 0004.',
  'Webhooks can post only in text channels you manage; there are none here for you.':
    'Les webhooks ne peuvent publier que dans les canaux textuels que vous gérez ; il n’y en a aucun ici pour vous.',
  'Webhook name': 'Nom du webhook',
  'Name, e.g. Build bot': 'Nom, ex. Bot de build',
  'Create webhook': 'Créer un webhook',
  'No webhooks yet.': 'Pas encore de webhooks.',
  'posts in #{channel} · made by {name}': 'publie dans #{channel} · créé par {name}',
  'Its address stops working at once; anything using it can no longer post. This cannot be undone.':
    'Son adresse cesse de fonctionner immédiatement ; rien de ce qui l’utilise ne peut plus publier. C’est irréversible.',
  'Delete webhook': 'Supprimer le webhook',

  'Backup saved. Keep the file and your recovery phrase in different places.':
    'Sauvegarde enregistrée. Gardez le fichier et votre phrase de récupération à des endroits différents.',
  'Backup & recovery': 'Sauvegarde et récupération',
  "If this computer is lost or replaced, a backup file plus your recovery phrase brings back your River ID, contacts, communities, messages and posts. Without the phrase the file is unreadable — to River's server, and to anyone else.":
    'Si cet ordinateur est perdu ou remplacé, un fichier de sauvegarde et votre phrase de récupération restaurent votre River ID, vos contacts, communautés, messages et publications. Sans la phrase, le fichier est illisible — pour le serveur de River comme pour quiconque.',
  '1. Your recovery phrase': '1. Votre phrase de récupération',
  '18 words. Write them on paper and keep them somewhere safe. Anyone with these words and a backup file can become you; River will never ask you for them.':
    '18 mots. Écrivez-les sur papier et gardez-les en lieu sûr. Quiconque a ces mots et un fichier de sauvegarde peut devenir vous ; River ne vous les demandera jamais.',
  'Recovery phrase': 'Phrase de récupération',
  'Hide phrase': 'Masquer la phrase',
  'Show recovery phrase': 'Afficher la phrase de récupération',
  'Create my recovery phrase': 'Créer ma phrase de récupération',
  '2. Save a backup file': '2. Enregistrez un fichier de sauvegarde',
  'Last backup: {time}. Make a new one now and then — it only contains what existed when you made it.':
    'Dernière sauvegarde : {time}. Faites-en une nouvelle de temps en temps — elle ne contient que ce qui existait à ce moment-là.',
  'You have no backup yet.': 'Vous n’avez pas encore de sauvegarde.',
  'Show your recovery phrase (step 1) and write it down first — without it, a backup can never be opened.':
    'Affichez d’abord votre phrase de récupération (étape 1) et notez-la — sans elle, une sauvegarde ne peut jamais être ouverte.',
  'Save encrypted backup…': 'Enregistrer une sauvegarde chiffrée…',
  'To restore: install River on the new computer and choose {restore} on the first screen. Files you received are referenced by the backup, not copied into it; recent ones can still be downloaded.':
    'Pour restaurer : installez River sur le nouvel ordinateur et choisissez {restore} sur le premier écran. Les fichiers reçus sont référencés par la sauvegarde, pas copiés dedans ; les plus récents peuvent encore être téléchargés.',
  'Backup file (.riverbackup)': 'Fichier de sauvegarde (.riverbackup)',
  'Recovery phrase (18 words)': 'Phrase de récupération (18 mots)',
  'Restoring…': 'Restauration…',
  Restore: 'Restaurer',
  'Setting up your public address (one-time download, {percent}%)…':
    'Configuration de votre adresse publique (téléchargement unique, {percent} %)…',
  'Starting…': 'Démarrage…',
  'Online — members can reach your communities': 'En ligne — les membres peuvent joindre vos communautés',
  'today at {time}': 'aujourd’hui à {time}',
  'Checking…': 'Vérification…',
  'Keep my communities online from this PC': 'Garder mes communautés en ligne depuis ce PC',
  'Free, and no account anywhere. River runs your community server and gives it a public address. Your communities live on this PC: nothing is deleted when it restarts, and River backs them up every day.':
    'Gratuit, sans compte nulle part. River fait tourner votre serveur de communautés et lui donne une adresse publique. Vos communautés vivent sur ce PC : rien n’est supprimé au redémarrage, et River les sauvegarde chaque jour.',
  'Host communities on this PC': 'Héberger des communautés sur ce PC',
  'Stop hosting?': 'Arrêter l’hébergement ?',
  'Members can’t reach the communities on this PC until you turn hosting back on. Nothing is deleted.':
    'Les membres ne pourront plus joindre les communautés de ce PC tant que vous n’aurez pas réactivé l’hébergement. Rien n’est supprimé.',
  'Stop hosting': 'Arrêter l’hébergement',
  'Keep hosting': 'Continuer l’hébergement',
  'River Host, the separate host from River 1.0.8, is set up on this PC and running. Turning this on moves your community into River — same members, same messages — and removes River Host. Its folder stays as a backup.':
    'River Host, l’hébergeur séparé de River 1.0.8, est installé sur ce PC et actif. En activant ceci, votre communauté passe dans River — mêmes membres, mêmes messages — et River Host est retiré. Son dossier reste comme sauvegarde.',
  'River Host, the separate host from River 1.0.8, is set up on this PC. Turning this on moves your community into River — same members, same messages — and removes River Host. Its folder stays as a backup.':
    'River Host, l’hébergeur séparé de River 1.0.8, est installé sur ce PC. En activant ceci, votre communauté passe dans River — mêmes membres, mêmes messages — et River Host est retiré. Son dossier reste comme sauvegarde.',
  'Download progress': 'Progression du téléchargement',
  'Copy address': 'Copier l’adresse',
  'Permanent address, free through Tailscale. It never changes, and members stay connected.':
    'Adresse permanente, gratuite via Tailscale. Elle ne change jamais et les membres restent connectés.',
  'This address changes every so often. Members’ River apps find the new one by themselves.':
    'Cette adresse change de temps en temps. Les applications River des membres trouvent la nouvelle toutes seules.',
  'Address announcements are off, so members need the new address after a restart.':
    'Les annonces d’adresse sont désactivées : après un redémarrage, les membres ont besoin de la nouvelle adresse.',
  'Last backup {when}': 'Dernière sauvegarde {when}',
  'No backup yet': 'Pas encore de sauvegarde',
  'Backing up…': 'Sauvegarde…',
  'Back up now': 'Sauvegarder maintenant',
  'Open hosting folder': 'Ouvrir le dossier d’hébergement',
  'Keep this PC awake while hosting': 'Garder ce PC éveillé pendant l’hébergement',
  'Stops the PC from going to sleep by itself so members can always reach you. The screen can still turn off.':
    'Empêche le PC de se mettre en veille tout seul pour que les membres puissent toujours vous joindre. L’écran peut quand même s’éteindre.',
  'While hosting is on, River keeps running in the tray when you close the window. It does not start by itself when you sign in to Linux: open River after restarting this PC.':
    'Tant que l’hébergement est actif, River continue dans la zone de notification quand vous fermez la fenêtre. Il ne démarre pas seul à la connexion sous Linux : ouvrez River après avoir redémarré ce PC.',
  'While hosting is on, River starts with your PC and keeps running in the tray when you close the window.':
    'Tant que l’hébergement est actif, River démarre avec votre PC et continue dans la zone de notification quand vous fermez la fenêtre.',
  'Members can always open River and write: if this PC is off, their messages wait on their devices and arrive when it is back.':
    'Les membres peuvent toujours ouvrir River et écrire : si ce PC est éteint, leurs messages attendent sur leurs appareils et arrivent à son retour.',
  'One last step: allow your permanent address': 'Dernière étape : autorisez votre adresse permanente',
  'Tailscale asks you once to allow a public address for this PC.':
    'Tailscale vous demande une seule fois d’autoriser une adresse publique pour ce PC.',
  'Allow in Tailscale': 'Autoriser dans Tailscale',
  'Your permanent address is not working yet': 'Votre adresse permanente ne fonctionne pas encore',
  'Members still reach you at the changing address above; River tries the permanent one again every few minutes. In Tailscale, check that Funnel and HTTPS are allowed for this PC.':
    'Les membres vous joignent toujours via l’adresse changeante ci-dessus ; River réessaie l’adresse permanente toutes les quelques minutes. Dans Tailscale, vérifiez que Funnel et HTTPS sont autorisés pour ce PC.',
  'Try again now': 'Réessayer maintenant',
  'Switching to your permanent address…': 'Passage à votre adresse permanente…',
  'Tailscale is signed in. This can take a minute the first time.':
    'Tailscale est connecté. La première fois, cela peut prendre une minute.',
  'Get a permanent address — free': 'Obtenez une adresse permanente — gratuite',
  'Calls and chats stay connected, and your invite links always work. Only this PC needs it; members install nothing extra.':
    'Les appels et discussions restent connectés, et vos liens d’invitation fonctionnent toujours. Seul ce PC en a besoin ; les membres n’installent rien de plus.',
  'Install Tailscale (free).': 'Installez Tailscale (gratuit).',
  'Download Tailscale': 'Télécharger Tailscale',
  'Open Tailscale and sign in — Google, Microsoft or GitHub all work.':
    'Ouvrez Tailscale et connectez-vous — Google, Microsoft ou GitHub fonctionnent.',
  "That's it: River switches over by itself.": 'C’est tout : River bascule tout seul.',
  'I did it — check now': 'C’est fait — vérifier maintenant',
  "Hi! Let's be friends on River 👋": 'Salut ! Soyons amis sur River 👋',
  '{name} is already your friend — here is your chat.': '{name} est déjà votre ami — voici votre discussion.',
  'This person is already your friend — here is your chat.':
    'Cette personne est déjà votre amie — voici votre discussion.',
  'You already sent {name} a friend request. It waits for their answer.':
    'Vous avez déjà envoyé une demande d’ami à {name}. Elle attend sa réponse.',
  'You already sent them a friend request. It waits for their answer.':
    'Vous lui avez déjà envoyé une demande d’ami. Elle attend sa réponse.',
  'You are now friends with {name}': 'Vous êtes maintenant ami avec {name}',
  'You are now friends': 'Vous êtes maintenant amis',
  'You blocked {name}. Unblock them in Messages first.':
    'Vous avez bloqué {name}. Débloquez cette personne dans Messages d’abord.',
  'You blocked this person. Unblock them in Messages first.':
    'Vous avez bloqué cette personne. Débloquez-la dans Messages d’abord.',
  'Could not send the request. Try again.': 'La demande n’a pas pu être envoyée. Réessayez.',

  'River user {id}': 'Utilisateur River {id}',
  'That did not work.': 'Cela n’a pas fonctionné.',
  'Your River server': 'Votre serveur River',
  'Everyone who uses River through your server, and every community on it. The server never sees messages or names; names show for people you share a community or a conversation with.':
    'Toutes les personnes qui utilisent River via votre serveur, et toutes ses communautés. Le serveur ne voit jamais les messages ni les noms ; les noms s’affichent pour les personnes avec qui vous partagez une communauté ou une conversation.',
  'Online now': 'En ligne',
  'Timed out or banned': 'Exclus ou bannis',
  'Search people': 'Rechercher des personnes',
  'Search by name or ID': 'Rechercher par nom ou ID',
  'Nobody matches.': 'Personne ne correspond.',
  Banned: 'Banni',
  'Joined {date}': 'Inscrit le {date}',
  'Reason: {reason}': 'Motif : {reason}',
  Unban: 'Débannir',
  'Time out {name}': 'Exclure temporairement {name}',
  'Time out…': 'Exclure temporairement…',
  'No communities yet.': 'Pas encore de communauté.',
  'A community you are not in': 'Une communauté dont vous ne faites pas partie',
  'Owner {name}': 'Propriétaire : {name}',
  'created {date}': 'créée le {date}',
  'Ban {name}?': 'Bannir {name} ?',
  'Remove {name}?': 'Retirer {name} ?',
  'Delete {name}?': 'Supprimer {name} ?',
  'They are signed out at once and cannot use River on your server until you unban them. Nothing is deleted.':
    'Cette personne est déconnectée immédiatement et ne peut plus utiliser River sur votre serveur tant que vous ne la débannissez pas. Rien n’est supprimé.',
  'Their account leaves your server: they are removed from every community, communities they own are deleted, and they would need to create a new account. Messages they already sent stay.':
    'Son compte quitte votre serveur : la personne est retirée de toutes les communautés, celles qu’elle possède sont supprimées, et elle devrait créer un nouveau compte. Les messages déjà envoyés restent.',
  'Reason (optional, shown to them)': 'Motif (facultatif, affiché à la personne)',
  'Remove account': 'Retirer le compte',
  'That did not work. Try again.': 'Cela n’a pas fonctionné. Réessayez.',
  'Accounts you create': 'Comptes que vous créez',
  'Invite-only: only people you make a sign-up link for can join.':
    'Sur invitation : seules les personnes à qui vous créez un lien d’inscription peuvent rejoindre.',
  'Open: anyone who downloads River can create an account here.':
    'Ouvert : toute personne qui télécharge River peut créer un compte ici.',
  'Allow anyone to join': 'Autoriser tout le monde à rejoindre',
  'Make invite-only': 'Passer sur invitation',
  'Username for the new account': 'Nom d’utilisateur du nouveau compte',
  'Send this link to @{username} — they open it in River and the account is theirs:':
    'Envoyez ce lien à @{username} — en l’ouvrant dans River, le compte devient le sien :',
  'Could not copy the link. Select it and copy it yourself.':
    'Impossible de copier le lien. Sélectionnez-le et copiez-le vous-même.',
  'Waiting to be claimed:': 'En attente d’activation :',
  Images: 'Images',
  Videos: 'Vidéos',
  Documents: 'Documents',
  'Your files': 'Vos fichiers',
  'Everything shared with you in messages and posts. Each file is encrypted with its own key and only decrypted on this computer when you open or save it.':
    'Tout ce qui a été partagé avec vous dans les messages et publications. Chaque fichier est chiffré avec sa propre clé et n’est déchiffré sur cet ordinateur que lorsque vous l’ouvrez ou l’enregistrez.',
  'Files appear here once you have an account and share something.':
    'Les fichiers apparaissent ici dès que vous avez un compte et partagez quelque chose.',
  'File type': 'Type de fichier',
  'Search by name or person': 'Rechercher par nom ou personne',
  'No files yet.': 'Pas encore de fichiers.',
  'Show in chat': 'Afficher dans la discussion',
  'Your people': 'Vos proches',
  'Setting up your account… River keeps trying by itself, and friends can be added as soon as it is ready.':
    'Configuration de votre compte… River continue d’essayer tout seul, et vous pourrez ajouter des amis dès qu’il sera prêt.',
  'Your account needs the sign-up link from whoever runs your River server — paste it in the card above.':
    'Votre compte a besoin du lien d’inscription fourni par la personne qui gère votre serveur River — collez-le dans la carte ci-dessus.',
  'Friends need an account on a River server. Join or create a community first — it only takes a moment.':
    'Les amis nécessitent un compte sur un serveur River. Rejoignez ou créez d’abord une communauté — ça ne prend qu’un instant.',
  'Go to Communities': 'Aller aux communautés',
  Pending: 'En attente',
  'River never uploads an address book. Add people with a link, or from a community.':
    'River ne téléverse jamais de carnet d’adresses. Ajoutez des personnes avec un lien ou depuis une communauté.',
  'Search friends': 'Rechercher des amis',
  'All friends': 'Tous les amis',
  Requests: 'Demandes',
  'No friends are online right now.': 'Aucun ami n’est en ligne pour le moment.',
  'No friends yet.': 'Pas encore d’amis.',
  'No friend requests right now.': 'Aucune demande d’ami pour le moment.',
  "You haven't blocked anyone.": 'Vous n’avez bloqué personne.',
  'Request sent — waiting for them to accept': 'Demande envoyée — en attente d’acceptation',
  'Safety number verified': 'Numéro de sécurité vérifié',
  'Safety number changed': 'Numéro de sécurité modifié',
  'Open chat': 'Ouvrir la discussion',
  'Cancel request': 'Annuler la demande',
  'Voice call': 'Appel vocal',
  Accept: 'Accepter',
  'Read message': 'Lire le message',
  Ignore: 'Ignorer',
  Unblock: 'Débloquer',
  "That's you!": 'C’est vous !',
  'That QR code is not a River friend code.': 'Ce QR code n’est pas un code d’ami River.',
  "That's your own code.": 'C’est votre propre code.',
  'Type their username — like @alex. They get your message as a request.':
    'Saisissez son nom d’utilisateur — par exemple @alex. Votre message lui arrivera comme une demande.',
  "Friend's username": 'Nom d’utilisateur de l’ami',
  'Scan QR code': 'Scanner un QR code',
  "Scan a friend's QR code": 'Scanner le QR code d’un ami',
  'Point the camera at the QR code in their River: Friends → Add friend → Show QR code.':
    'Pointez la caméra vers le QR code dans son River : Amis → Ajouter un ami → Afficher le QR code.',
  'You are @{username}': 'Vous êtes @{username}',
  'You are on River': 'Vous êtes sur River',
  'Share your username and people can add you. Or send them your link.':
    'Partagez votre nom d’utilisateur pour qu’on puisse vous ajouter. Ou envoyez votre lien.',
  'Choose a username in Settings → Account so people can add you by name. You can still share your link.':
    'Choisissez un nom d’utilisateur dans Paramètres → Compte pour qu’on puisse vous ajouter par nom. Vous pouvez aussi partager votre lien.',
  'Copy friend link': 'Copier le lien d’ami',
  'Hide QR code': 'Masquer le QR code',
  'Show QR code': 'Afficher le QR code',
  'Your friend link as a QR code': 'Votre lien d’ami sous forme de QR code',
  'Your friend scans this in River to send you a friend request.':
    'Votre ami le scanne dans River pour vous envoyer une demande d’ami.',
  'Join me in {community}: {link}': 'Rejoins-moi dans {community} : {link}',
  'Invite to {community} sent to {name}': 'Invitation à {community} envoyée à {name}',
  'Invite {name} to a community': 'Inviter {name} dans une communauté',
  'Invited to {community}': 'Invité dans {community}',
  'Invite to a community': 'Inviter dans une communauté',
  'River Security Center': 'Centre de sécurité River',
  'What is protected, right now': 'Ce qui est protégé, en ce moment',
  'This page only shows what this version of River actually does. Features that are not built yet are marked as planned, never as active.':
    'Cette page ne montre que ce que cette version de River fait réellement. Les fonctions pas encore construites sont indiquées comme prévues, jamais comme actives.',
  'Your identity': 'Votre identité',
  'Read these words to a contact (in person or on a call) and ask them to compare with what River shows for you. If they match, nobody has swapped your key. To check a contact, open your conversation with them and choose View safety number; once you mark it verified, River warns you and stops sending if it ever changes.':
    'Lisez ces mots à un contact (en personne ou par appel) et demandez-lui de les comparer avec ce que River affiche pour vous. S’ils correspondent, personne n’a remplacé votre clé. Pour vérifier un contact, ouvrez votre conversation et choisissez « Voir le numéro de sécurité » ; une fois marqué comme vérifié, River vous avertit et cesse d’envoyer s’il change.',
  'Security status': 'État de la sécurité',
  'Release signing keys': 'Clés de signature des versions',
  'Updates are installed only when signed by one of these keys, which are built into this copy of River.':
    'Les mises à jour ne sont installées que si elles sont signées par l’une de ces clés, intégrées à cette copie de River.',
  'Honest limits': 'Limites honnêtes',
  'River is not an anonymity network and cannot hide that you use it.':
    'River n’est pas un réseau d’anonymat et ne peut pas cacher que vous l’utilisez.',
  'Malware on an unlocked device can read anything you can.':
    'Un logiciel malveillant sur un appareil déverrouillé peut lire tout ce que vous pouvez lire.',
  'People you message can always screenshot or forward what you send.':
    'Les personnes à qui vous écrivez peuvent toujours faire une capture d’écran ou transférer ce que vous envoyez.',
  'River has not had an independent security audit yet.':
    'River n’a pas encore fait l’objet d’un audit de sécurité indépendant.',
  'Threat model': 'Modèle de menaces',
  'Privacy policy': 'Politique de confidentialité',
  'Report a vulnerability': 'Signaler une vulnérabilité',
  'Share with your people': 'Partagez avec vos proches',
  'Posts and stories go only to people you choose, end-to-end encrypted. Join a community or create an account first.':
    'Les publications et les stories ne vont qu’aux personnes que vous choisissez, chiffrées de bout en bout. Rejoignez d’abord une communauté ou créez un compte.',
  'Your friends are the people you have accepted in Messages.':
    'Vos amis sont les personnes que vous avez acceptées dans Messages.',
  'Friends — {count}': 'Amis — {count}',
  'Share something with your friends…': 'Partagez quelque chose avec vos amis…',
  'Nothing here yet': 'Rien ici pour l’instant',
  'Posts from your contacts appear here. Add people in Messages (or from a community) and share your first post — only the people you choose can see it.':
    'Les publications de vos contacts apparaissent ici. Ajoutez des personnes dans Messages (ou depuis une communauté) et partagez votre première publication — seules les personnes choisies la verront.',
  Stories: 'Stories',
  'Your story': 'Votre story',
  'Add to your story': 'Ajouter à votre story',
  'View your profile': 'Voir votre profil',
  'Encrypting photos…': 'Chiffrement des photos…',
  'Sharing…': 'Partage…',
  'Added to your story': 'Ajouté à votre story',
  Shared: 'Partagé',
  'Could not share.': 'Impossible de partager.',
  'Create post': 'Créer une publication',
  'Say something (shown for 24 hours)…': 'Dites quelque chose (visible 24 heures)…',
  'What do you want to share?': 'Que voulez-vous partager ?',
  'Photos & videos': 'Photos et vidéos',
  'Add photos or videos': 'Ajouter des photos ou vidéos',
  'Who can see this': 'Qui peut voir ceci',
  'All friends ({count})': 'Tous les amis ({count})',
  'Only people I choose': 'Seulement les personnes que je choisis',
  "Encrypted separately for each person who can see it. River's server only relays ciphertext.":
    'Chiffré séparément pour chaque personne qui peut le voir. Le serveur de River ne relaie que du texte chiffré.',
  'Share to story': 'Partager en story',
  Post: 'Publier',
  'Post options': 'Options de la publication',
  'Delete post': 'Supprimer la publication',
  'It will be removed for everyone you shared it with.':
    'Elle sera retirée pour toutes les personnes avec qui vous l’avez partagée.',
  Unlike: 'Je n’aime plus',
  Like: 'J’aime',
  React: 'Réagir',
  'Add a comment…': 'Ajouter un commentaire…',
  'Add a comment': 'Ajouter un commentaire',
  "{name}'s story": 'Story de {name}',
  'Close story': 'Fermer la story',
  'This story could not be loaded.': 'Cette story n’a pas pu être chargée.',
  'Video story': 'Story vidéo',
  Previous: 'Précédent',
  Next: 'Suivant',
  'Seen by {count}': 'Vue par {count}',
  'Replied to your story: {text}': 'A répondu à votre story : {text}',
  'Sent to {name}': 'Envoyé à {name}',
  'Reply to {name}…': 'Répondre à {name}…',
  'Reply to {name}': 'Répondre à {name}',
  'Bio saved': 'Bio enregistrée',
  'Your bio': 'Votre bio',
  'Add a short bio.': 'Ajoutez une courte bio.',
  'Edit bio': 'Modifier la bio',
  Close: 'Fermer',
  'No posts yet.': 'Pas encore de publications.',

  'River — share your screen': 'River — partager l’écran',
  'Share your screen?': 'Partager votre écran ?',
  'People in this call will see “{source}” until you press Stop sharing on the red bar at the top of that screen.':
    'Les personnes de l’appel verront « {source} » jusqu’à ce que vous appuyiez sur Arrêter le partage dans la barre rouge en haut de cet écran.',
  Share: 'Partager',
  'Automatic updates are disabled in development builds.':
    'Les mises à jour automatiques sont désactivées dans les versions de développement.',
  'Keep River running': 'Laisser River tourner',
  'Quit anyway': 'Quitter quand même',
  'Quit River?': 'Quitter River ?',
  'Your communities go offline while River is closed.':
    'Vos communautés sont hors ligne tant que River est fermé.',
  'This PC hosts them. Members can still open River and write; their messages are sent when River runs here again.':
    'Ce PC les héberge. Les membres peuvent toujours ouvrir River et écrire ; leurs messages partiront quand River tournera à nouveau ici.',
  'River — hosting your communities': 'River — héberge vos communautés',
  'River — starting hosting…': 'River — démarrage de l’hébergement…',
  'Open River': 'Ouvrir River',
  'Hosting: online': 'Hébergement : en ligne',
  'Hosting: connecting…': 'Hébergement : connexion…',
  'Quit River': 'Quitter River',
  'River is still running': 'River tourne toujours',
  'Calls and messages keep coming in. Quit from the River icon in the tray.':
    'Les appels et messages continuent d’arriver. Quittez depuis l’icône River dans la zone de notification.',
  "River's window keeps closing": 'La fenêtre de River n’arrête pas de se fermer',
  'The interface stopped {times} times ({reason}). Try again, or quit and start River with --disable-gpu. The log is in {folder}.':
    'L’interface s’est arrêtée {times} fois ({reason}). Réessayez, ou quittez et lancez River avec --disable-gpu. Le journal se trouve dans {folder}.',
  'An update was downloaded but its signature did not verify, so it was not installed. Your current version is unchanged.':
    'Une mise à jour a été téléchargée, mais sa signature n’a pas été vérifiée : elle n’a pas été installée. Votre version actuelle est inchangée.',
  'Could not reach the update server. River will try again later.':
    'Impossible de joindre le serveur de mises à jour. River réessaiera plus tard.',
  'Checking for updates failed. River will try again later.':
    'La recherche de mises à jour a échoué. River réessaiera plus tard.',
  'The update download failed. River will try again later.':
    'Le téléchargement de la mise à jour a échoué. River réessaiera plus tard.',
  'The update could not be completed. Your current version is unchanged.':
    'La mise à jour n’a pas pu aboutir. Votre version actuelle est inchangée.',
  'Keep them': 'Les garder',
  '90 days': '90 jours',
  '1 year': '1 an',
  'Keep messages on this device': 'Garder les messages sur cet appareil',
  'Disappearing messages for new chats': 'Messages éphémères pour les nouvelles discussions',
  'Direct and group messages older than you choose are deleted from this device. The people you talk to, and your other devices, keep their own copies. Community channels live on their server and are not affected. Chats you start from now on get the disappearing-messages timer; chats you already have keep theirs.':
    'Les messages privés et de groupe plus anciens que la durée choisie sont supprimés de cet appareil. Vos interlocuteurs et vos autres appareils gardent leurs propres copies. Les canaux des communautés vivent sur leur serveur et ne sont pas concernés. Les discussions que vous commencez désormais reçoivent le minuteur de messages éphémères ; celles que vous avez déjà gardent le leur.',
  Test: 'Test',
  'Connect through a proxy (Tor)': 'Se connecter via un proxy (Tor)',
  'On: River connects to its server only through {kind} proxy {address}.':
    'Activé : River se connecte à son serveur uniquement via le proxy {kind} {address}.',
  'Off: River connects to its server directly.': 'Désactivé : River se connecte directement à son serveur.',
  'What it hides: your IP address from your River server (and from the address relay and GitHub’s update checks). What it does not hide: your account, who you talk to and when — the server still sees that, and your messages were already end-to-end encrypted. While it is on, calls never connect directly: voice goes through a TURN relay or your server, so the people you call do not see your address either, and video or screen sharing work only if your server offers a TURN relay. Link previews are off. If the proxy stops, River does not connect at all — it never falls back to a direct connection. A server on this computer, and hosting from this PC, do not use the proxy. Computers only for now.':
    'Ce qu’il cache : votre adresse IP à votre serveur River (et au relais d’adresses et aux vérifications de mises à jour de GitHub). Ce qu’il ne cache pas : votre compte, avec qui vous parlez et quand — le serveur le voit toujours, et vos messages étaient déjà chiffrés de bout en bout. Tant qu’il est actif, les appels ne se connectent jamais directement : la voix passe par un relais TURN ou votre serveur, donc vos correspondants ne voient pas non plus votre adresse, et la vidéo ou le partage d’écran ne fonctionnent que si votre serveur propose un relais TURN. Les aperçus de liens sont désactivés. Si le proxy s’arrête, River ne se connecte plus du tout — il ne repasse jamais en connexion directe. Un serveur sur cet ordinateur et l’hébergement depuis ce PC n’utilisent pas le proxy. Ordinateurs uniquement pour l’instant.',
  Type: 'Type',
  Address: 'Adresse',
  Port: 'Port',
  'Testing…': 'Test en cours…',
  'Test connection': 'Tester la connexion',
  'Turn on': 'Activer',
  'Turn off': 'Désactiver',
  'Preparing…': 'Préparation…',
  'Link this device again': 'Réassocier cet appareil',
  'Setting up…': 'Configuration…',
  'Set up my account again': 'Reconfigurer mon compte',
  'On a device that still has your account, open Settings → Account → Devices → Link a new device, then use its code here.':
    'Sur un appareil qui a encore votre compte, ouvrez Paramètres → Compte → Appareils → Associer un nouvel appareil, puis utilisez son code ici.',
  'Set up again: a new account for your identity — same name and messages here; rejoin communities with an invite. Link again: if this device was removed, join your account from a device that still has it.':
    'Reconfigurer : un nouveau compte pour votre identité — même nom et mêmes messages ici ; rejoignez à nouveau les communautés avec une invitation. Réassocier : si cet appareil a été retiré, rattachez-le à votre compte depuis un appareil qui l’a encore.',
  'Link this device again?': 'Réassocier cet appareil ?',
  'River forgets the account and identity on this device, then you link it again with a code from a device that still has your account. Your messages and contacts on this device stay, and only work again with the same account.':
    'River oublie le compte et l’identité sur cet appareil, puis vous le réassociez avec un code d’un appareil qui a encore votre compte. Vos messages et contacts sur cet appareil restent, et ne fonctionnent à nouveau qu’avec le même compte.',
  Continue: 'Continuer',
  'Your data': 'Vos données',
  'Save a readable copy (JSON) of what this device keeps: your profile, settings, contacts, direct messages, groups, calls, your posts and saved messages. It never contains your keys. Keep it somewhere safe — it is not encrypted.':
    'Enregistrez une copie lisible (JSON) de ce que garde cet appareil : profil, paramètres, contacts, messages privés, groupes, appels, publications et messages enregistrés. Elle ne contient jamais vos clés. Gardez-la en lieu sûr — elle n’est pas chiffrée.',
  'Export my data': 'Exporter mes données',
  'Your account was deleted.': 'Votre compte a été supprimé.',
  'Delete account': 'Supprimer le compte',
  'Removes your account from your server for good: you leave every community (communities you own are deleted), and your keys and devices are removed there. Messages you already sent stay where they are, encrypted. Your identity and the messages on this device stay on this device.':
    'Supprime définitivement votre compte de votre serveur : vous quittez toutes les communautés (celles que vous possédez sont supprimées), et vos clés et appareils y sont retirés. Les messages déjà envoyés restent où ils sont, chiffrés. Votre identité et les messages de cet appareil restent sur cet appareil.',
  'Delete account…': 'Supprimer le compte…',
  'Delete your account?': 'Supprimer votre compte ?',
  'This cannot be undone. Type DELETE to confirm.': 'C’est irréversible. Tapez DELETE pour confirmer.',
  Confirmation: 'Confirmation',
  'Keep my account': 'Garder mon compte',
  'Deleting…': 'Suppression…',
  Server: 'Serveur',
  'River uses a server to deliver encrypted messages between devices. Anyone can run one. The server never receives your keys or readable messages.':
    'River utilise un serveur pour acheminer les messages chiffrés entre appareils. Tout le monde peut en faire tourner un. Le serveur ne reçoit jamais vos clés ni de messages lisibles.',
  'Must start with https:// (http:// is allowed only for a server on this computer).':
    'Doit commencer par https:// (http:// n’est autorisé que pour un serveur sur cet ordinateur).',
  'Remove server': 'Retirer le serveur',
  'River server reachable': 'Serveur River joignable',
  'Server {version} · protocol {protocol} · compatible':
    'Serveur {version} · protocole {protocol} · compatible',
  'Connection failed': 'Échec de la connexion',
  'Testing sends one anonymous request for the server’s version — nothing about you.':
    'Le test envoie une seule requête anonyme pour la version du serveur — rien sur vous.',
  'Create your account on {host}': 'Créez votre compte sur {host}',
  'River registers your River ID, your public identity key and a new key for this device. No phone number, e-mail or name is sent. Your display name stays on this computer.':
    'River enregistre votre River ID, votre clé d’identité publique et une nouvelle clé pour cet appareil. Aucun numéro de téléphone, e-mail ou nom n’est envoyé. Votre nom affiché reste sur cet ordinateur.',
  'Creating account…': 'Création du compte…',
  'Anyone with it can ask to join; you let each person in':
    'Quiconque l’a peut demander à rejoindre ; vous faites entrer chaque personne',
  'Enter a full address, like https://river.example.org':
    'Saisissez une adresse complète, comme https://river.example.org',
  'The server address must start with https://': 'L’adresse du serveur doit commencer par https://',
  'The address must not contain a password, query or #fragment':
    'L’adresse ne doit pas contenir de mot de passe, de requête ni de #fragment',
  'Enter a host name or address, like 127.0.0.1': 'Saisissez un nom d’hôte ou une adresse, comme 127.0.0.1',
  'Hosting runs on a computer. Phones join communities hosted elsewhere.':
    'L’hébergement se fait sur un ordinateur. Les téléphones rejoignent des communautés hébergées ailleurs.',
  'River on iPhone cannot update itself: iOS only lets you install a new version by sideloading its IPA again. Get it from the download page.':
    'River sur iPhone ne peut pas se mettre à jour seul : iOS ne permet d’installer une nouvelle version qu’en réinstallant son IPA. Récupérez-la sur la page de téléchargement.',
  'River {version} is signed with a different key than the River installed on this phone (early Android builds were signed with one-off preview keys), so Android cannot install it as an update. To get it, uninstall River and install the new version from the download page. Uninstalling deletes River’s data on this phone — your identity, messages and settings — unless you make a backup first in Settings → Backup.':
    'River {version} est signé avec une autre clé que le River installé sur ce téléphone (les premières versions Android étaient signées avec des clés d’essai uniques) : Android ne peut donc pas l’installer comme mise à jour. Pour l’obtenir, désinstallez River et installez la nouvelle version depuis la page de téléchargement. La désinstallation efface les données de River sur ce téléphone — identité, messages et paramètres — sauf si vous faites d’abord une sauvegarde dans Paramètres → Sauvegarde.',
  'River found an update whose signature did not verify, so it was not downloaded. Your current version is unchanged.':
    'River a trouvé une mise à jour dont la signature n’a pas été vérifiée : elle n’a pas été téléchargée. Votre version actuelle est inchangée.',
  'An update was downloaded but did not match River’s signed release, so it was not installed. Your current version is unchanged.':
    'Une mise à jour a été téléchargée mais ne correspondait pas à la version signée de River : elle n’a pas été installée. Votre version actuelle est inchangée.',
  'The newest River release has no download for this phone’s processor. Your current version is unchanged.':
    'La dernière version de River n’a pas de téléchargement pour le processeur de ce téléphone. Votre version actuelle est inchangée.',
  'Android did not install the update ({reason}). Your current version is unchanged.':
    'Android n’a pas installé la mise à jour ({reason}). Votre version actuelle est inchangée.',
  'Android did not install the update. Your current version is unchanged.':
    'Android n’a pas installé la mise à jour. Votre version actuelle est inchangée.',

  // Counted texts (one: 0 and 1; many: millions)
  'Back, {count} unread': { one: 'Retour, {count} non lu', other: 'Retour, {count} non lus' },
  'Group call · {group} ({count} people)': {
    one: 'Appel de groupe · {group} ({count} personne)',
    many: 'Appel de groupe · {group} ({count} de personnes)',
    other: 'Appel de groupe · {group} ({count} personnes)',
  },
  '{count} days ago': { one: 'il y a {count} jour', other: 'il y a {count} jours' },
  '{count} h ago': { one: 'il y a {count} h', other: 'il y a {count} h' },
  '{count} in voice': { one: '{count} en vocal', other: '{count} en vocal' },
  '{count} let in': { one: '{count} admise', other: '{count} admises' },
  '{count} members': { one: '{count} membre', many: '{count} de membres', other: '{count} membres' },
  '{count} mentions': { one: '{count} mention', other: '{count} mentions' },
  '{count} min': { one: '{count} min', other: '{count} min' },
  '{count} min ago': { one: 'il y a {count} min', other: 'il y a {count} min' },
  '{count} new direct messages': {
    one: '{count} nouveau message privé',
    other: '{count} nouveaux messages privés',
  },
  '{count} new messages': { one: '{count} nouveau message', other: '{count} nouveaux messages' },
  '{count} online': { one: '{count} en ligne', other: '{count} en ligne' },
  '{count} s': { one: '{count} s', other: '{count} s' },
  '{count} unread': { one: '{count} non lu', other: '{count} non lus' },
  '{name} is calling {group} ({count} people)': {
    one: '{name} appelle {group} ({count} personne)',
    other: '{name} appelle {group} ({count} personnes)',
  },
  '{tab}, {count} mentions': { one: '{tab}, {count} mention', other: '{tab}, {count} mentions' },
  '{tab}, {count} missed': { one: '{tab}, {count} manqué', other: '{tab}, {count} manqués' },
  '{tab}, {count} unread': { one: '{tab}, {count} non lu', other: '{tab}, {count} non lus' },
  'Gave {role} to {done} of {count} members.': {
    one: '{role} donné à {done} membre sur {count}.',
    many: '{role} donné à {done} membres sur {count}.',
    other: '{role} donné à {done} membres sur {count}.',
  },
  'Took {role} from {done} of {count} members.': {
    one: '{role} retiré à {done} membre sur {count}.',
    many: '{role} retiré à {done} membres sur {count}.',
    other: '{role} retiré à {done} membres sur {count}.',
  },
  'Copied {count} entries.': {
    one: '{count} entrée copiée.',
    many: '{count} d’entrées copiées.',
    other: '{count} entrées copiées.',
  },
  '{count} synced channels follow these permissions. Channels with their own permissions keep them.': {
    one: '{count} canal synchronisé suit ces autorisations. Les canaux qui ont les leurs les gardent.',
    many: '{count} de canaux synchronisés suivent ces autorisations. Les canaux qui ont les leurs les gardent.',
    other: '{count} canaux synchronisés suivent ces autorisations. Les canaux qui ont les leurs les gardent.',
  },
  '{count} people': { one: '{count} personne', many: '{count} de personnes', other: '{count} personnes' },
  'last {count} days': {
    one: 'dernier {count} jour',
    many: '{count} de derniers jours',
    other: '{count} derniers jours',
  },
  'messages, last {count} days': {
    one: 'messages, dernier {count} jour',
    many: 'messages, {count} de derniers jours',
    other: 'messages, {count} derniers jours',
  },
  '{count} days': { one: '{count} jour', many: '{count} de jours', other: '{count} jours' },
  'Messages per day over the last {count} days': {
    one: 'Messages par jour sur le dernier {count} jour',
    many: 'Messages par jour sur les {count} de derniers jours',
    other: 'Messages par jour sur les {count} derniers jours',
  },
  '{count} weeks ago': {
    one: 'il y a {count} semaine',
    many: 'il y a {count} de semaines',
    other: 'il y a {count} semaines',
  },
  '{count} communities': {
    one: '{count} communauté',
    many: '{count} de communautés',
    other: '{count} communautés',
  },
  '{count} devices': { one: '{count} appareil', many: '{count} d’appareils', other: '{count} appareils' },
  '{count} channels': { one: '{count} canal', many: '{count} de canaux', other: '{count} canaux' },
  'The community, its channels and its messages are deleted for all {count} members. This cannot be undone.':
    {
      one: 'La communauté, ses canaux et ses messages sont supprimés pour son {count} membre. C’est irréversible.',
      many: 'La communauté, ses canaux et ses messages sont supprimés pour ses {count} de membres. C’est irréversible.',
      other:
        'La communauté, ses canaux et ses messages sont supprimés pour ses {count} membres. C’est irréversible.',
    },
  '{count} mutual communities': {
    one: '{count} communauté en commun',
    many: '{count} de communautés en commun',
    other: '{count} communautés en commun',
  },
  'shared with {count} people': {
    one: 'partagé avec {count} personne',
    many: 'partagé avec {count} de personnes',
    other: 'partagé avec {count} personnes',
  },
  'View all {count} comments': {
    one: 'Voir {count} commentaire',
    many: 'Voir les {count} de commentaires',
    other: 'Voir les {count} commentaires',
  },
  '{count} weeks': { one: '{count} semaine', many: '{count} de semaines', other: '{count} semaines' },
  '{count} hours': { one: '{count} heure', many: '{count} d’heures', other: '{count} heures' },
  '{count} minutes': { one: '{count} minute', many: '{count} de minutes', other: '{count} minutes' },
  '{count} seconds': { one: '{count} seconde', many: '{count} de secondes', other: '{count} secondes' },
};
