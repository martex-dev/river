import type { Language } from '../languages.ts';
import type { Dictionary } from '../types.ts';

type Lang = Exclude<Language, 'en'>;

/**
 * Texts of the community screens on computers (the community sweep after 2.21.2), each with every
 * language side by side, so a new text cannot miss one. Merged into each language's dictionary.
 */
const TEXTS: Record<string, Record<Lang, string>> = {
  // Roles in reach (2.20.2)
  'Out of your reach': {
    bg: 'Извън вашия обхват',
    de: 'Außerhalb deiner Reichweite',
    es: 'Fuera de tu alcance',
    fr: 'Hors de votre portée',
    it: 'Fuori dalla tua portata',
    pl: 'Poza Twoim zasięgiem',
    'pt-BR': 'Fora do seu alcance',
    ru: 'Вне вашей досягаемости',
    tr: 'Erişiminizin dışında',
    uk: 'Поза вашою досяжністю',
  },
  'You can only edit roles below your highest role.': {
    bg: 'Можете да редактирате само роли под най-високата си роля.',
    de: 'Du kannst nur Rollen unter deiner höchsten Rolle bearbeiten.',
    es: 'Solo puedes editar roles por debajo de tu rol más alto.',
    fr: 'Vous ne pouvez modifier que les rôles situés sous votre rôle le plus élevé.',
    it: 'Puoi modificare solo i ruoli sotto il tuo ruolo più alto.',
    pl: 'Możesz edytować tylko role poniżej swojej najwyższej roli.',
    'pt-BR': 'Você só pode editar cargos abaixo do seu cargo mais alto.',
    ru: 'Вы можете изменять только роли ниже вашей самой высокой роли.',
    tr: 'Yalnızca en yüksek rolünüzün altındaki rolleri düzenleyebilirsiniz.',
    uk: 'Ви можете змінювати лише ролі нижче вашої найвищої ролі.',
  },
  'This role has permissions you do not have ({permissions}), so you cannot edit, give, take, move or delete it.':
    {
      bg: 'Тази роля има права, които вие нямате ({permissions}), затова не можете да я редактирате, давате, отнемате, местите или изтривате.',
      de: 'Diese Rolle hat Berechtigungen, die du nicht hast ({permissions}). Du kannst sie daher nicht bearbeiten, vergeben, entziehen, verschieben oder löschen.',
      es: 'Este rol tiene permisos que tú no tienes ({permissions}), así que no puedes editarlo, darlo, quitarlo, moverlo ni eliminarlo.',
      fr: 'Ce rôle a des permissions que vous n’avez pas ({permissions}) : vous ne pouvez donc pas le modifier, l’attribuer, le retirer, le déplacer ni le supprimer.',
      it: 'Questo ruolo ha permessi che tu non hai ({permissions}), quindi non puoi modificarlo, assegnarlo, toglierlo, spostarlo o eliminarlo.',
      pl: 'Ta rola ma uprawnienia, których nie masz ({permissions}), więc nie możesz jej edytować, nadawać, odbierać, przenosić ani usuwać.',
      'pt-BR':
        'Este cargo tem permissões que você não tem ({permissions}), então você não pode editá-lo, dá-lo, retirá-lo, movê-lo nem excluí-lo.',
      ru: 'У этой роли есть права, которых нет у вас ({permissions}), поэтому вы не можете изменять, выдавать, снимать, перемещать или удалять её.',
      tr: 'Bu rol sizde olmayan izinlere sahip ({permissions}); bu yüzden onu düzenleyemez, veremez, geri alamaz, taşıyamaz veya silemezsiniz.',
      uk: 'Ця роль має дозволи, яких у вас немає ({permissions}), тому ви не можете змінювати, надавати, забирати, переміщувати чи видаляти її.',
    },
  'Roles at or above your highest role, or with permissions you do not have, cannot be given or taken by you, so they are not offered.':
    {
      bg: 'Роли на нивото на най-високата ви роля или над нея, както и роли с права, които нямате, не можете да давате или отнемате, затова не са предложени.',
      de: 'Rollen auf oder über deiner höchsten Rolle oder mit Berechtigungen, die du nicht hast, kannst du weder vergeben noch entziehen. Sie werden daher nicht angeboten.',
      es: 'Los roles iguales o superiores a tu rol más alto, o con permisos que no tienes, no puedes darlos ni quitarlos, así que no se ofrecen.',
      fr: 'Les rôles égaux ou supérieurs à votre rôle le plus élevé, ou ayant des permissions que vous n’avez pas, ne peuvent pas être attribués ni retirés par vous : ils ne sont donc pas proposés.',
      it: 'I ruoli pari o superiori al tuo ruolo più alto, o con permessi che non hai, non puoi assegnarli né toglierli, quindi non vengono proposti.',
      pl: 'Ról na poziomie Twojej najwyższej roli lub wyżej albo z uprawnieniami, których nie masz, nie możesz nadawać ani odbierać, więc nie są proponowane.',
      'pt-BR':
        'Cargos no nível do seu cargo mais alto ou acima dele, ou com permissões que você não tem, não podem ser dados nem retirados por você, por isso não são oferecidos.',
      ru: 'Роли на уровне вашей самой высокой роли или выше, а также роли с правами, которых у вас нет, вы не можете выдавать или снимать, поэтому они не предлагаются.',
      tr: 'En yüksek rolünüzle aynı seviyedeki veya üstündeki roller ile sizde olmayan izinlere sahip roller sizin tarafınızdan verilemez veya geri alınamaz; bu yüzden sunulmazlar.',
      uk: 'Ролі на рівні вашої найвищої ролі чи вище, а також ролі з дозволами, яких у вас немає, ви не можете надавати чи забирати, тому вони не пропонуються.',
    },
  "can moderate, so it can't be self-assigned": {
    bg: 'може да модерира, затова не може да се избира сам',
    de: 'kann moderieren und ist daher nicht selbst wählbar',
    es: 'puede moderar, así que no se puede elegir uno mismo',
    fr: 'peut modérer, donc ne peut pas être choisi par les membres',
    it: 'può moderare, quindi non può essere scelto dai membri',
    pl: 'może moderować, więc nie można jej wybrać samemu',
    'pt-BR': 'pode moderar, então não pode ser escolhido pelos membros',
    ru: 'может модерировать, поэтому её нельзя выбрать самому',
    tr: 'moderasyon yapabildiği için üyeler kendisi seçemez',
    uk: 'може модерувати, тому її не можна вибрати самому',
  },
  'has permissions you do not have, so you cannot offer it': {
    bg: 'има права, които нямате, затова не можете да я предложите',
    de: 'hat Berechtigungen, die du nicht hast, daher kannst du sie nicht anbieten',
    es: 'tiene permisos que no tienes, así que no puedes ofrecerlo',
    fr: 'a des permissions que vous n’avez pas, vous ne pouvez donc pas le proposer',
    it: 'ha permessi che non hai, quindi non puoi offrirlo',
    pl: 'ma uprawnienia, których nie masz, więc nie możesz jej zaproponować',
    'pt-BR': 'tem permissões que você não tem, então você não pode oferecê-lo',
    ru: 'имеет права, которых у вас нет, поэтому вы не можете её предложить',
    tr: 'sizde olmayan izinlere sahip olduğu için onu sunamazsınız',
    uk: 'має дозволи, яких у вас немає, тому ви не можете її запропонувати',
  },
};

const LANGS: Lang[] = ['bg', 'de', 'es', 'fr', 'it', 'pl', 'pt-BR', 'ru', 'tr', 'uk'];

export const COMMUNITY: Record<Lang, Dictionary> = Object.fromEntries(
  LANGS.map((lang) => [lang, Object.fromEntries(Object.entries(TEXTS).map(([en, t]) => [en, t[lang]]))]),
) as Record<Lang, Dictionary>;
