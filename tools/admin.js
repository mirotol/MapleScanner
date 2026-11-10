// The admin's fixes to the shared price database. Only the holder of ADMIN_TOKEN can make them.
//
//   set MAPLE_ADMIN_TOKEN and CLOUD_URL, then:
//   node tools/admin.js uploaders                                     every install that uploaded
//   node tools/admin.js reports '{"id": 123}'                         who reported listing 123
//   node tools/admin.js move '{"from": "Battle Crossbow", "to": "Crossbow"}'
//   node tools/admin.js delete-listing '{"id": 123}'
//   node tools/admin.js delete-item '{"name": "Red Potion"}'
//   node tools/admin.js block '{"uploader": 7}'                      and remove what only it reported
const [action, json = '{}'] = process.argv.slice(2);
const url = process.env.CLOUD_URL, token = process.env.MAPLE_ADMIN_TOKEN;
if (!action || !url || !token) {
  console.error('Usage: set MAPLE_ADMIN_TOKEN and CLOUD_URL, then: node tools/admin.js <action> [json]');
  process.exit(1);
}

(async () => {
  const res = await fetch(`${url.replace(/\/$/, '')}/v1/admin/${action}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: json,
  });
  console.log(JSON.stringify(await res.json().catch(() => ({ status: res.status })), null, 2));
  if (!res.ok) process.exit(1);
})().catch(err => { console.error(err.message); process.exit(1); });
