# DEPLOY.md

How to put the planner online (step 14, spec §3). You do steps 1 to 7 by hand once. After that, updating is one command: `npm run deploy`.

What you end up with:
- A DigitalOcean droplet (a small always-on Linux server) running the app.
- `https://planner.yourdomain.com`, with the certificate from Caddy. Your domain's DNS stays on Cloudflare.
- A password sign-in for one person.
- A backup every night at 3:30 AM Chicago time, copied off the droplet to Backblaze B2.
- The app on your phone's home screen.

Throughout, replace `planner.yourdomain.com` with your real subdomain and `203.0.113.10` with your droplet's IP address. Commands marked **Mac** run in Terminal on your Mac, from this folder. Commands marked **droplet** run on the server over SSH.

## 1. Make sure you have an SSH key (Mac)

```bash
ls ~/.ssh/id_ed25519.pub
```

If the output says "No such file", make one. Press Enter to accept the default location, and pick a passphrase:

```bash
ssh-keygen -t ed25519 -C "planner droplet"
```

Copy the public key so you can paste it into DigitalOcean in the next step. This is the public half, which is safe to share:

```bash
pbcopy < ~/.ssh/id_ed25519.pub
```

## 2. Create the droplet (DigitalOcean website)

1. Sign in at cloud.digitalocean.com, then click **Create**, then **Droplets**.
2. **Region:** New York (NYC3) is closest to Chicago.
3. **Image:** Ubuntu **24.04 (LTS) x64**.
4. **Size:** Basic, Regular SSD, **$6/month (1 GB RAM, 1 CPU, 25 GB disk)**. That's plenty for one person. The setup adds swap so installing fits in 1 GB.
5. **Authentication:** **SSH Key**, then **New SSH Key**. Paste the key you copied and name it after your Mac. Don't choose Password.
6. Optional: turn on the free **Monitoring**. DigitalOcean's weekly **Backups** cost 20% extra. They're a second safety net, since the nightly backup in step 7 already covers the data.
7. **Hostname:** `planner`. Then click **Create Droplet**.
8. When it's ready, copy its **ipv4** address, like `203.0.113.10`.

Check that you can sign in (**Mac**). Type `yes` when it asks about the fingerprint, then `exit`:

```bash
ssh root@203.0.113.10
```

## 3. Point the subdomain at the droplet (Cloudflare website)

Do this before step 4, so the address already leads to the droplet when Caddy asks for the certificate.

1. Sign in at dash.cloudflare.com and click your domain.
2. In the left menu, open **DNS**, then **Records**, then click **Add record**.
3. Fill it in:
   - **Type:** `A`
   - **Name:** `planner`. Cloudflare adds your domain, so this becomes `planner.yourdomain.com`.
   - **IPv4 address:** your droplet's IP, like `203.0.113.10`.
   - **Proxy status:** click the orange cloud so it turns **gray**, which means **DNS only**. This matters, for two reasons:
     - Caddy proves it controls the address by answering Let's Encrypt directly on ports 80 and 443. With the orange cloud on, Cloudflare answers instead, and the certificate fails.
     - With the orange cloud on, Cloudflare also decrypts all your traffic in the middle.
   - **TTL:** Auto.
4. Click **Save**. The record list should show `planner`, `A`, your IP, and **DNS only** with a gray cloud.
5. Don't add an `AAAA` record unless you turned on IPv6 for the droplet.
6. Only if the list already has **CAA** records: add one more. Type `CAA`, name `planner`, tag "Only allow specific hostnames", CA domain name `letsencrypt.org`. If there are no CAA records, skip this.

Check it (**Mac**). Wait a minute, then run:

```bash
dig +short planner.yourdomain.com
```

It should print exactly your droplet's IP. If it prints a different address, like `104.x.x.x` or `172.x.x.x`, the cloud is still orange. Go back and make it gray.

Cloudflare's SSL/TLS settings (Flexible, Full, and so on) don't apply to a DNS-only record, so leave them as they are.

## 4. Set up the server (Mac, then droplet)

Copy the setup files to the droplet (**Mac**):

```bash
rsync -a deploy/ root@203.0.113.10:/root/planner-deploy/
```

Run the setup with your subdomain (**Mac**). It takes a few minutes:

```bash
ssh root@203.0.113.10 "bash /root/planner-deploy/setup-server.sh planner.yourdomain.com"
```

The setup does all of the following:
- Updates Ubuntu.
- Installs Node 22, Caddy, rclone, and SQLite.
- Adds 1 GB of swap.
- Turns on a firewall that allows only SSH and the web.
- Creates a `planner` user that signs in with your same SSH key.
- Installs the app service, the nightly backup timer, and the Caddy settings for your subdomain.

It ends with "Done." If it stops early, read the last lines, fix the cause, and run it again. Running it again is safe.

Check that you can sign in as the planner user (**Mac**), then `exit`:

```bash
ssh planner@planner.yourdomain.com
```

## 5. The first deploy (Mac)

Tell the deploy script where the droplet is. Open `.env` on your Mac in a text editor and add this line, with your subdomain:

```
DEPLOY_HOST=planner@planner.yourdomain.com
```

Commit your work first, since the deploy only sends committed code. Then run:

```bash
npm run deploy
```

It runs `npm run check`, copies the code, then installs and builds on the droplet. This first time, it stops with "sign-in isn't set up yet." That's expected. Continue with step 6.

## 6. Your data, `.env`, and the password

**Copy your planner data.** Stop `npm run dev` on your Mac first, so nothing changes during the copy. Make a fresh, consistent copy of your database (**Mac**):

```bash
npm run db:backup
```

It prints the file it saved, like `data/backups/auto-2026-10-03T171500.db`. Send that file to the droplet as `planner.db`, using the name it printed (**Mac**):

```bash
scp data/backups/auto-2026-10-03T171500.db planner@planner.yourdomain.com:notebook-planner/data/planner.db
```

From now on, the droplet's copy is the real one. Changes you make on localhost stay on your Mac.

**Copy `.env`.** This sends your Anthropic key and model to the droplet over SSH, so you don't retype them (**Mac**):

```bash
scp .env planner@planner.yourdomain.com:notebook-planner/.env
```

**Set the sign-in password.** Sign in to the droplet (**Mac**):

```bash
ssh planner@planner.yourdomain.com
```

Then run these on the **droplet**. Type the password twice; it won't show as you type. Use at least 10 characters, and save it in your password manager:

```bash
cd ~/notebook-planner
```

```bash
chmod 600 .env
```

```bash
npm run set-password
```

`set-password` writes `AUTH_PASSWORD_HASH` and `SESSION_SECRET` into `.env`. Only the hash is stored, never the password. Running it again changes the password and signs every device out.

Type `exit` to leave the droplet. Then deploy again (**Mac**):

```bash
npm run deploy
```

This time it ends with "the planner is up." Open `https://planner.yourdomain.com` and sign in. The first visit can take a few seconds while Caddy gets the certificate.

## 7. Nightly backup off the droplet (Backblaze website, then droplet)

The backup copies the database into `data/backups/` on the droplet every night at 3:30 AM Chicago time, then sends it to a Backblaze B2 bucket. B2 is free up to 10 GB, and the database is far smaller.

**Create the bucket (Backblaze website).**
1. Make an account at backblaze.com and choose **B2 Cloud Storage**.
2. Under **B2 Cloud Storage**, then **Buckets**, click **Create a Bucket**.
   - **Name:** something unique, like `planner-backups-` plus a few random letters.
   - **Files in Bucket are:** **Private**.
   - Default encryption: **Enable**.
3. On the new bucket, open **Lifecycle Settings**. Choose **Use custom lifecycle rules** and add a rule:
   - File path: leave it empty.
   - Days till hide: `60`.
   - Days till delete: `1`.

   This keeps 60 days of nightly copies.
4. Under **Application Keys**, click **Add a New Application Key**.
   - **Name:** `planner-droplet`.
   - **Allow access to Bucket(s):** only your bucket.
   - **Type of Access:** Read and Write.
5. It shows a **keyID** and an **applicationKey** once. Keep the page open for the next step. Don't paste them anywhere else.

**Connect the droplet to it (droplet).** Sign in with `ssh planner@planner.yourdomain.com`, then run:

```bash
rclone config
```

Answer the prompts:
- `n` for a new remote.
- Name: `offsite`.
- Storage: type `b2`.
- account: paste the keyID.
- key: paste the applicationKey.
- hard_delete: press Enter.
- Edit advanced config: `n`.
- Keep this remote: `y`.
- Then `q` to quit.

rclone saves the key in `~/.config/rclone/rclone.conf` on the droplet only.

Tell the backup which bucket to use. Open `.env` in an editor:

```bash
nano ~/notebook-planner/.env
```

Add this line with your bucket's name, then save with Ctrl+O, Enter, and Ctrl+X:

```
BACKUP_REMOTE=offsite:planner-backups-xxxx
```

Run one backup now to check it (**droplet**):

```bash
bash ~/notebook-planner/deploy/backup.sh
```

```bash
rclone ls offsite:planner-backups-xxxx
```

The second command should list an `auto-....db` file. To see when the nightly backup last ran, and whether it worked:

```bash
systemctl list-timers planner-backup.timer
```

```bash
journalctl -u planner-backup -n 20
```

## 8. Put it on your phone

**iPhone:** open `https://planner.yourdomain.com` in **Safari** and sign in. Tap the Share button, then **Add to Home Screen**, then **Add**. Open it from the new icon, and it runs full screen. Notifications in step 15 need it opened from the home screen.

**Android:** open the address in Chrome and sign in. Open the ⋮ menu and tap **Add to Home screen**, or **Install app**.

A device stays signed in for 90 days after you last used it.

## 9. Turn on notifications (each device, in the app)

The deploy makes the push keys on the droplet by itself, so nothing needs doing on the server.

On each device that should get notifications:
1. **iPhone:** open the planner **from the home screen icon** (not Safari). iPhone only allows notifications there.
2. Tap the gear, then scroll to **Notifications**.
3. Next to **This device**, tap **Turn on**, then **Allow** when asked.
4. Tap **Send a test notification**. It should arrive within a few seconds.
5. Switch off any kinds you don't want. These choices are shared by every device.

If it says notifications are blocked:
- **iPhone:** open Settings, then Notifications, then Planner, and turn on Allow Notifications.
- **Mac or PC:** open the browser's site settings for the planner (the icon left of the address) and allow notifications.

Then tap **Turn on** again.

## Updating

Commit, then run (**Mac**):

```bash
npm run deploy
```

The deploy does these steps in order:
1. Runs `npm run check`.
2. Copies the committed code.
3. Installs packages, but only when `package-lock.json` changed.
4. Builds the web app.
5. Makes the push keys for notifications, the first time only.
6. Backs up the database.
7. Restarts the app. New migrations run as it starts.
8. Waits for the app to answer.

The installed phone app picks up the new version the next time it's opened.

## When something's wrong

All of these run on the **droplet**.

The app's log:

```bash
journalctl -u planner -n 100
```

Whether the app is running:

```bash
systemctl status planner
```

Caddy's log, for certificate problems:

```bash
sudo journalctl -u caddy -n 100
```

If the certificate fails, it's almost always one of these:
- The Cloudflare record is still orange-clouded.
- The DNS record isn't pointing at the droplet yet.
- Ports 80 and 443 are blocked. Check with `sudo ufw status`.

After fixing the cause, run `sudo systemctl restart caddy`. The `planner` user can only restart the app without a password, so for Caddy, sign in as root: `ssh root@203.0.113.10`.

You forgot the password: on the droplet, run `cd ~/notebook-planner`, then `npm run set-password`, then `sudo systemctl restart planner`.

## Restoring a backup

Sign in as root (**Mac**):

```bash
ssh root@203.0.113.10
```

Stop the app:

```bash
systemctl stop planner
```

Switch to the planner user:

```bash
su - planner
```

```bash
cd ~/notebook-planner/data
```

Keep the current database aside, just in case:

```bash
mv planner.db planner-before-restore.db
```

```bash
rm -f planner.db-wal planner.db-shm
```

Then put the backup in place. For a copy on the droplet, list them with `ls backups/`, then copy one:

```bash
cp backups/auto-2026-10-03T033000.db planner.db
```

For a copy from B2, use this instead:

```bash
rclone copy offsite:planner-backups-xxxx/auto-2026-10-03T033000.db . && mv auto-2026-10-03T033000.db planner.db
```

Type `exit` to go back to root, then start the app:

```bash
systemctl start planner
```

## What's where on the droplet

| What | Where |
|---|---|
| The app's code | `/home/planner/notebook-planner` |
| The database | `/home/planner/notebook-planner/data/planner.db` |
| Local backups | `/home/planner/notebook-planner/data/backups/`. Automatic ones older than 14 days are removed. |
| Secrets | `/home/planner/notebook-planner/.env`, readable by the planner user only |
| The app service | `/etc/systemd/system/planner.service` |
| The backup timer | `/etc/systemd/system/planner-backup.{service,timer}` |
| Caddy's settings | `/etc/caddy/Caddyfile` |

Any change to the files in `deploy/` needs step 4 again: the rsync, then the setup.
