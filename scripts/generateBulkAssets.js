import connectionManager from '../server/db/connection.js';
import { runMigrations } from '../server/db/migrations/umzug-instance.js';
import crypto from 'crypto';
import bcrypt from 'bcrypt';

// ── Safety guard ────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  console.error('\n❌  Refusing to seed test data in production!');
  console.error('    Set NODE_ENV=development or omit it to run this script.\n');
  process.exit(1);
}

// Shared live-API guard: never race the dev API on its own DB.
{
  const { refuseIfDevApiLive } = await import('../server/utils/liveApiGuard.js');
  const verdict = await refuseIfDevApiLive('generateBulkAssets');
  if (verdict.refused) process.exit(1);
}

async function generateBulkAssets() {
    const db = await connectionManager.connect();
    console.log('Starting bulk environment generation...');

    await runMigrations(db);
    console.log('Migrations applied...');

    console.log('Generating test users...');

    const testUsers = [
        { name: 'admin',  email: 'admin@studio.com',  role: 'IT Admin', pass: 'admin'     },
        { name: 'admin1', email: 'admin1@studio.com', role: 'IT Admin', pass: '12345678' },
        { name: 'admin2', email: 'admin2@studio.com', role: 'IT Admin', pass: '12345678' },
        { name: 'staff1', email: 'staff1@studio.com', role: 'Staff',    pass: '12345678' },
        { name: 'staff2', email: 'staff2@studio.com', role: 'Staff',    pass: '12345678' },
    ];

    let usersCreated = 0;
    for (const user of testUsers) {
        try {
            const hash = await bcrypt.hash(user.pass, 10);
            const existing = await db.get('SELECT id FROM users WHERE email = ? OR name = ?', [user.email, user.name]);
            if (existing) {
                await db.run(
                    'UPDATE users SET name = ?, email = ?, role = ?, password_hash = ?, requires_password_change = 0 WHERE id = ?',
                    [user.name, user.email, user.role, hash, existing.id]
                );
            } else {
                await db.run(
                    'INSERT INTO users (name, email, role, password_hash, requires_password_change) VALUES (?, ?, ?, ?, 0)',
                    [user.name, user.email, user.role, hash]
                );
            }
            usersCreated++;
        } catch {
            console.error(`Skipped creating ${user.name} (Likely already exists)`);
        }
    }
    console.log(`${usersCreated} test users verified/created!`);

    console.log('Generating hardware assets...');
    const types = ['Workstation', 'Camera', 'Monitor', 'Tablet', 'Lens', 'Lighting'];
    for (const type of types) {
        await db.run('INSERT OR IGNORE INTO asset_types (name) VALUES (?)', [type]);
    }

    const users = await db.all('SELECT id, dept_id FROM users');
    const depts = await db.all('SELECT id FROM departments');

    const gearPool = {
        'Workstation': ['Mac Studio M2 Ultra', 'HP Z8 Fury', 'Threadripper PRO 5995WX', 'Dell Precision 7920'],
        'Camera': ['ARRI Alexa Mini LF', 'RED V-Raptor 8K', 'Sony FX9', 'Blackmagic URSA Mini'],
        'Monitor': ['Sony BVM-HX310', 'EIZO ColorEdge CG319X', 'Apple Pro Display XDR', 'LG OLED C3'],
        'Tablet': ['Wacom Cintiq Pro 24', 'Wacom Intuos Pro', 'iPad Pro 12.9', 'Huion Kamvas Pro'],
        'Lens': ['Zeiss Master Prime 35mm', 'Cooke S4/i 50mm', 'Angenieux Optimo 24-290mm', 'Sigma Cine 18-35mm'],
        'Lighting': ['ARRI SkyPanel S60-C', 'Aputure LS 1200d', 'Astera Titan Tube', 'LiteMat Plus 4']
    };

    let successCount = 0;

    for (let i = 0; i < 25; i++) {
        const type = types[Math.floor(Math.random() * types.length)];
        const models = gearPool[type];
        const model = models[Math.floor(Math.random() * models.length)];

        const id = `${type.substring(0,3).toUpperCase()}-${Math.floor(Math.random() * 9000) + 1000}`;
        const serial = `SN-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

        const isDeployed = Math.random() > 0.4;
        let assignedUser = null;
        let deptId = null;
        let status = 'In Storage';

        if (isDeployed && users.length > 0) {
            assignedUser = users[Math.floor(Math.random() * users.length)];
            deptId = assignedUser.dept_id;
            status = 'Deployed';
        } else if (depts.length > 0 && Math.random() > 0.5) {
            deptId = depts[Math.floor(Math.random() * depts.length)].id;
        }

        try {
            await db.run(`
                INSERT INTO assets (id, type, model, serial_number, status, dept_id, assigned_to_user_id, image_url)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [id, type, model, serial, status, deptId, assignedUser ? assignedUser.id : null, '/uploads/dummy-seed.png']);
            successCount++;
        } catch {
           // Silently ignores duplicates
        }
    }

    console.log(`Successfully generated ${successCount} test assets!`);
    console.log(`Environment ready. Use the accounts to test the Helpdesk dispatcher rules!`);
}

generateBulkAssets().catch(console.error);
