import { Pool } from 'pg';
import { databaseName, resolveDatabaseUrl } from './db-target';

// Usage:
//   npm run dev:sample-teachers            adds four made-up teachers (replaces earlier ones)
//   npm run dev:sample-teachers -- --remove   removes them again
//
// For LOOKING at the public pages (search, profile, landing pages) on your own computer.
// Development database only: it refuses any database whose name does not end with _dev.
// Every sample phone number starts with +21629999, which is how they are found and removed.
// They bypass the review queue and the founding offer on purpose, so the founding counter
// is never touched.

const PHONE_PREFIX = '+21629999';

type Sample = {
  n: number;
  name: string;
  slug: string;
  governorate: string;
  diploma: string;
  experience: string;
  modes: string[];
  bio: string;
  zoneCount: number;
  levels: [string, number][];
  subjects: [string, number][];
  rating: [number, number];
  expired?: boolean;
};

const SAMPLES: Sample[] = [
  {
    n: 1,
    name: 'Wassima Chaaben',
    slug: 'wassima-chaaben-physique-sfax',
    governorate: 'sfax',
    diploma: 'high_school_teacher',
    experience: '5_10',
    modes: ['at_home', 'online'],
    bio: 'Professeure de physique depuis dix ans, je prépare les élèves du secondaire au baccalauréat avec des exercices progressifs et un suivi régulier.\nCours à domicile à Sfax ou en ligne.',
    zoneCount: 2,
    levels: [
      ['secondaire', 1],
      ['secondaire', 2],
      ['secondaire', 3],
      ['secondaire', 4],
    ],
    subjects: [
      ['physique', 25000],
      ['mathematiques', 30000],
    ],
    rating: [4.5, 12],
  },
  {
    n: 2,
    name: 'Habib Trabelsi',
    slug: 'habib-trabelsi-anglais-tunis',
    governorate: 'tunis',
    diploma: 'university_teacher',
    experience: '10_15',
    modes: ['online'],
    bio: "Enseignant universitaire, je donne des cours d'anglais pour tous les niveaux, du primaire au préparatoire, uniquement en ligne.",
    zoneCount: 0,
    levels: [
      ['primaire', 1],
      ['primaire', 2],
      ['primaire', 3],
      ['preparatoire', 7],
    ],
    subjects: [['anglais', 18000]],
    rating: [0, 0],
  },
  {
    n: 3,
    name: 'Sana Gharbi',
    slug: 'sana-gharbi-mathematiques-sousse',
    governorate: 'sousse',
    diploma: 'engineer_executive',
    experience: '3_5',
    modes: ['at_teacher'],
    bio: "Ingénieure, j'aide les étudiants de licence en mathématiques et en informatique. Les cours ont lieu chez moi, à Sousse.",
    zoneCount: 1,
    levels: [
      ['universite', 1],
      ['universite', 2],
      ['universite', 3],
    ],
    subjects: [
      ['mathematiques', 40000],
      ['informatique', 45000],
    ],
    rating: [0, 0],
  },
  {
    // Hidden on purpose: its plan ended yesterday, so it must never be listed.
    n: 4,
    name: 'Expire Exemple',
    slug: 'expire-exemple-francais-tunis',
    governorate: 'tunis',
    diploma: 'other_graduate',
    experience: '1_3',
    modes: ['at_home'],
    bio: "Ce profil d'exemple est expiré : il ne doit apparaître ni dans la recherche, ni sur sa page, ni dans le sitemap.",
    zoneCount: 1,
    levels: [['primaire', 4]],
    subjects: [['francais', 12000]],
    rating: [0, 0],
    expired: true,
  },
];

async function main() {
  const { url } = resolveDatabaseUrl([]);
  const name = databaseName(url);
  if (!name.endsWith('_dev')) {
    throw new Error(
      `Refusing to run: database "${name}" does not end with _dev.`,
    );
  }
  const pool = new Pool({ connectionString: url });
  try {
    const removed = await pool.query(
      'DELETE FROM users WHERE phone_e164 LIKE $1',
      [`${PHONE_PREFIX}%`],
    );
    if (process.argv.includes('--remove')) {
      console.log(`Removed ${removed.rowCount} sample teacher(s).`);
      return;
    }

    const one = async (sql: string, params: unknown[]) =>
      (await pool.query(sql, params)).rows[0];

    for (const sample of SAMPLES) {
      const governorate = await one(
        'SELECT id FROM governorates WHERE slug = $1',
        [sample.governorate],
      );
      const user = await one(
        `INSERT INTO users (role, phone_e164, password_hash, status, phone_verified_at,
                            phone_display_consent_at, terms_accepted_at)
         VALUES ('teacher', $1, '$argon2id$sample-no-login', 'active', now(), now(), now())
         RETURNING id`,
        [`${PHONE_PREFIX}${String(sample.n).padStart(3, '0')}`],
      );
      // Draft first: the levels, zones and subjects need the profile row to exist.
      await pool.query(
        `INSERT INTO teacher_profiles (user_id, full_name, diploma, experience, bio,
                                       governorate_id, modes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          user.id,
          sample.name,
          sample.diploma,
          sample.experience,
          sample.bio,
          governorate.id,
          sample.modes,
        ],
      );
      for (const [cycle, grade] of sample.levels) {
        await pool.query(
          `INSERT INTO teacher_levels
           SELECT $1, id FROM levels WHERE cycle = $2 AND grade = $3`,
          [user.id, cycle, grade],
        );
      }
      await pool.query(
        `INSERT INTO teacher_zones
         SELECT $1, $2, id FROM delegations
          WHERE governorate_id = $2 ORDER BY name_fr LIMIT $3`,
        [user.id, governorate.id, sample.zoneCount],
      );
      for (const [slug, rate] of sample.subjects) {
        await pool.query(
          `INSERT INTO teacher_subjects
           SELECT $1, id, $3 FROM subjects WHERE slug = $2`,
          [user.id, slug, rate],
        );
      }
      await pool.query(
        `UPDATE teacher_profiles
            SET status = 'approved', slug = $2, approved_at = now(),
                rating_avg = $3, rating_count = $4
          WHERE user_id = $1`,
        [user.id, sample.slug, sample.rating[0], sample.rating[1]],
      );
      await pool.query(
        `INSERT INTO entitlements (teacher_id, visibility_until)
         VALUES ($1, now() + ($2 || ' days')::interval)`,
        [user.id, sample.expired ? '-1' : '90'],
      );
    }
    console.log(
      `Added ${SAMPLES.length} sample teachers (${SAMPLES.length - 1} visible, 1 expired).`,
    );
    console.log('Remove them with: npm run dev:sample-teachers -- --remove');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
