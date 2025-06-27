# 📘 xcraft-core-bus

## Aperçu

Le module `xcraft-core-bus` est le cœur du système de communication du framework Xcraft. Il gère le cycle de vie et les opérations du bus de commandes et d'événements, permettant la communication entre tous les composants de l'écosystème Xcraft. Ce module orchestre le chargement dynamique des modules, la gestion des connexions réseau, et fournit l'infrastructure de base pour l'exécution des commandes et la diffusion d'événements.

## Sommaire

- [Structure du module](#structure-du-module)
- [Fonctionnement global](#fonctionnement-global)
- [Exemples d'utilisation](#exemples-dutilisation)
- [Interactions avec d'autres modules](#interactions-avec-dautres-modules)
- [Configuration avancée](#configuration-avancée)
- [Détails des sources](#détails-des-sources)

## Structure du module

Le module est organisé autour de trois composants principaux :

- **Bus** (`lib/index.js`) : Orchestrateur principal qui coordonne le Commander et le Notifier
- **Commander** (`lib/commander.js`) : Gestionnaire des commandes avec routage intelligent
- **Notifier** (`lib/notifier.js`) : Gestionnaire de diffusion d'événements
- **Orcish** (`lib/orcish.js`) : Générateur de noms et tokens pour l'identification des connexions

Le module expose également des commandes intégrées pour le chargement de modules et la collecte de métriques système.

## Fonctionnement global

### Architecture du bus

Le bus Xcraft fonctionne selon une architecture distribuée avec deux canaux principaux :

1. **Canal Commander** (pull/push) : Gère l'exécution des commandes avec routage intelligent vers les instances appropriées
2. **Canal Notifier** (pub/sub) : Diffuse les événements à tous les abonnés connectés

### Cycle de vie

1. **Initialisation** : Génération du token Great Hall, configuration des ports et options TLS
2. **Démarrage** : Lancement simultané du Commander et du Notifier sur leurs ports respectifs
3. **Chargement** : Découverte et enregistrement automatique des modules exposant `xcraftCommands`
4. **Fonctionnement** : Routage des commandes et diffusion des événements
5. **Arrêt** : Fermeture propre des connexions et notification de fin de session

### Gestion des modules

Le registre des commandes est peuplé au démarrage par la découverte automatique des modules. Le système recherche la propriété `xcraftCommands` dans tous les fichiers JavaScript des modules spécifiés et enregistre les commandes exposées.

### Routage intelligent

Le Commander intègre un système de routage intelligent qui :

- Dirige les commandes vers l'instance locale si disponible
- Redirige vers les instances distantes via le système Horde si nécessaire
- Gère la distribution par tribu pour les environnements multi-instances
- Applique les politiques de sécurité et de forwarding

## Exemples d'utilisation

### Chargement dynamique d'un module

```javascript
// Chargement d'un module via la commande intégrée
await this.quest.cmd('bus.module.load', {
  moduleName: 'goblin-workshop',
});
```

### Collecte de métriques système

```javascript
// Récupération des métriques de performance
const metrics = await this.quest.cmd('bus.xcraftMetrics', {});
console.log('Métriques V8:', metrics.data);
```

### Utilisation du bus dans un module

```javascript
// Dans un module exposant des commandes
exports.xcraftCommands = function () {
  return {
    handlers: {
      create: function* (msg, resp) {
        // Logique de création
        resp.events.send('entity.create.finished', {id: msg.data.id});
      },
    },
    rc: {
      create: {
        parallel: true,
        desc: 'Créer une nouvelle entité',
      },
    },
  };
};
```

## Interactions avec d'autres modules

### Modules fondamentaux

- **[xcraft-core-transport]** : Fournit l'infrastructure réseau sous-jacente pour les communications
- **[xcraft-core-busclient]** : Interface client pour interagir avec le bus depuis les modules
- **[xcraft-core-host]** : Gestion de l'identité de l'application et des arguments de démarrage
- **[xcraft-core-etc]** : Système de configuration centralisé

### Modules optionnels

- **[xcraft-core-horde]** : Gestion des instances distribuées et du routage inter-instances
- **[xcraft-core-activity]** : Gestion des activités et du parallélisme des commandes

### Intégration avec l'écosystème

Le bus sert de colonne vertébrale pour tous les modules Xcraft :

- Les modules `xcraft-core-*` exposent leurs services via le bus
- Les acteurs `goblin-*` communiquent exclusivement via le bus
- Les widgets reçoivent leurs données via les événements du bus

## Configuration avancée

| Option            | Description                                               | Type    | Valeur par défaut  |
| ----------------- | --------------------------------------------------------- | ------- | ------------------ |
| `host`            | Adresse IP ou nom d'hôte du serveur                       | string  | `127.0.0.1`        |
| `commanderHost`   | Adresse spécifique pour le Commander                      | string  | _(hérite de host)_ |
| `commanderPort`   | Port du service Commander                                 | number  | `35400`            |
| `notifierHost`    | Adresse spécifique pour le Notifier                       | string  | _(hérite de host)_ |
| `notifierPort`    | Port du service Notifier                                  | number  | `35800`            |
| `timeout`         | Timeout TCP en millisecondes                              | number  | `0`                |
| `serverKeepAlive` | Keep-alive pour connexions serveur                        | number  | `15000`            |
| `clientKeepAlive` | Keep-alive pour connexions client                         | number  | `6000`             |
| `noTLS`           | Désactiver le chiffrement TLS                             | boolean | `false`            |
| `unixSocketId`    | Identifiant pour sockets Unix                             | string  | _(vide)_           |
| `acceptIncoming`  | Accepter immédiatement les nouvelles connexions           | boolean | `true`             |
| `shutdownRemotes` | Arrêter les instances distantes                           | boolean | `false`            |
| `keyPath`         | Chemin vers la clé privée du serveur                      | string  | _(vide)_           |
| `certPath`        | Chemin vers le certificat du serveur                      | string  | _(vide)_           |
| `policiesPath`    | Chemin vers les politiques de sécurité                    | string  | _(vide)_           |
| `tribes`          | Configuration des tribus pour déploiement multi-instances | array   | `[]`               |

## Détails des sources

### `lib/index.js`

Classe principale `Bus` qui orchestre l'ensemble du système. Elle hérite d'`EventEmitter` et coordonne le démarrage, l'arrêt et le chargement des modules. La classe gère également la génération des tokens de sécurité et la configuration des connexions réseau.

#### Méthodes publiques

- **`boot(commandHandlers, next)`** — Démarre le bus avec la liste des gestionnaires de commandes, configure les ports et lance les services.
- **`stop()`** — Arrête proprement tous les services, ferme les connexions et notifie la fin de session.
- **`loadModule(resp, files, root, info, next)`** — Charge dynamiquement un module en analysant ses fichiers et en enregistrant ses commandes.
- **`acceptIncoming()`** — Active l'acceptation de nouvelles connexions sur le Commander et le Notifier.
- **`getToken()`** — Retourne le token de sécurité actuel du bus.
- **`generateOrcName()`** — Génère un nom unique pour identifier une connexion client.
- **`getCommander()`** — Retourne l'instance du Commander pour accès direct.
- **`getNotifier()`** — Retourne l'instance du Notifier pour accès direct.
- **`getRegistry()`** — Retourne le registre des commandes du Commander.
- **`getBusTokenFromId(cmd, id)`** — Détermine le token du bus approprié pour une commande et un ID donnés.
- **`runningModuleNames(onlyHot)`** — Retourne la liste des noms de modules en cours d'exécution.
- **`runningModuleLocations(onlyHot)`** — Retourne la liste des emplacements des modules en cours d'exécution.
- **`getModuleInfo(name, userModulePath)`** — Retourne les informations d'un module (chemin et pattern de fichiers).

### `lib/commander.js`

Classe `Commander` qui gère l'exécution des commandes avec un système de routage intelligent. Elle hérite de `Router` et implémente la logique de distribution des commandes vers les instances appropriées.

#### Fonctionnalités principales

- Routage automatique vers les instances locales ou distantes
- Gestion des activités et du parallélisme
- Support du système de tribus pour la distribution
- Gestion des erreurs et des commandes non disponibles

#### Méthodes publiques

- **`getRoutingKeyFromId(cmd, id, isRPC)`** — Détermine la clé de routage pour une commande donnée en fonction de l'ID cible.
- **`registerCommandHandler(name, location, info, rc, handler)`** — Enregistre un gestionnaire de commande dans le registre.
- **`isCommandRegistered(cmd)`** — Vérifie si une commande est enregistrée dans le registre.
- **`isModuleRegistered(name)`** — Vérifie si un module est déjà enregistré.
- **`getRegistry()`** — Retourne le registre local des commandes.
- **`getFullRegistry()`** — Retourne le registre complet incluant les commandes des instances distantes.
- **`getModuleInfo(name)`** — Retourne les informations d'un module spécifique.
- **`registerErrorHandler(handler)`** — Enregistre le gestionnaire d'erreurs intégré.
- **`registerAutoconnectHandler(handler)`** — Enregistre le gestionnaire de connexion automatique.
- **`registerDisconnectHandler(handler)`** — Enregistre le gestionnaire de déconnexion.
- **`registerShutdownHandler(handler)`** — Enregistre le gestionnaire d'arrêt du serveur.
- **`registerMotdHandler(handler)`** — Enregistre le gestionnaire de message du jour.
- **`registerBroadcastHandler(handler)`** — Enregistre le gestionnaire de diffusion.

### `lib/notifier.js`

Classe `Notifier` simple qui hérite de `Router` et gère la diffusion d'événements en mode publication/souscription. Elle utilise le pattern pub/sub pour distribuer les événements à tous les clients connectés.

### `lib/orcish.js`

Module utilitaire pour la génération de noms et tokens basé sur une liste de noms d'orcs fantastiques :

#### Méthodes publiques

- **`generateGreatHall()`** — Génère un token cryptographique sécurisé pour identifier le bus principal.
- **`generateOrcName(token)`** — Génère un nom unique basé sur une liste de noms d'orcs fantastiques pour identifier les connexions.

### `bus.js`

Fichier exposant les commandes intégrées du bus via `xcraftCommands` :

#### Commandes disponibles

- **`module.load`** — Charge dynamiquement un module spécifié par son nom.
- **`xcraftMetrics`** — Collecte les métriques de performance du processus Node.js actuel (V8, mémoire, CPU, système).
- **`${cmdNamespace}.xcraftMetrics`** — Agrège les métriques de toutes les instances connectées.

Les métriques collectées incluent :

- **Statistiques V8** : heap total/utilisé, contextes natifs/détachés, métadonnées de code
- **Utilisation processus** : CPU (user/system), mémoire RSS/heap/externe, buffers
- **Ressources système** : RSS max, mémoire partagée, fautes de page, I/O fichiers, IPC
- **Métriques OS** : priorité processus, mémoire totale système, uptime

---

_Ce document a été mis à jour pour refléter l'état actuel du code source._

[xcraft-core-transport]: https://github.com/Xcraft-Inc/xcraft-core-transport
[xcraft-core-busclient]: https://github.com/Xcraft-Inc/xcraft-core-busclient
[xcraft-core-host]: https://github.com/Xcraft-Inc/xcraft-core-host
[xcraft-core-etc]: https://github.com/Xcraft-Inc/xcraft-core-etc
[xcraft-core-horde]: https://github.com/Xcraft-Inc/xcraft-core-horde
[xcraft-core-activity]: https://github.com/Xcraft-Inc/xcraft-core-activity