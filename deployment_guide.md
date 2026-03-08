# Deploying Your GPS Tracking Platform

Since your platform is built entirely using Node.js and a local SQLite database, deploying it to the internet is very straightforward. You will need a Virtual Private Server (VPS) to host it, as standard web hosting (like GoDaddy) doesn't allow long-running TCP servers to listen for Teltonika tracker connections.

Here is the step-by-step guide to publishing your platform.

## 1. Get a Virtual Private Server (VPS)
You need a cloud server running Ubuntu Linux. Good options include:
- **DigitalOcean Droplet** ($4-$6/month)
- **Hetzner Cloud** (~$4/month)
- **AWS EC2 or Google Cloud Compute** (Free tiers available)

## 2. Prepare the Server
Once you have your server's IP address and SSH access, log in and install Node.js:

```bash
# Update server
sudo apt update && sudo apt upgrade -y

# Install Node.js (v20 or v22)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

## 3. Upload Your Code
You need to transfer your project folder (`d:\my first project`) to your new Linux server.
You can do this using Git/GitHub, or simply by zipping the folder and transferring it using SCP, FTP (FileZilla), or your cloud provider's web console.

*Note: Do not upload the `node_modules` folder or `tracking.db` if you want a fresh database.*

## 4. Install Dependencies
Navigate into your project directory on the server and install the required packages:

```bash
cd /path/to/your/project
npm install
```

## 5. Keep the Server Running Continuously (PM2)
If you just run `node server.js`, it will stop when you close your terminal. We use PM2 to keep it running forever and restart it if it crashes.

```bash
# Install PM2 globally
sudo npm install -g pm2

# Start your platform
pm2 start server.js --name "gps-platform"

# Save PM2 to start automatically if the server reboots
pm2 save
pm2 startup
```

## 6. Accessing the Dashboard Securely via Tailscale (Optional)
If you do not want to expose the dashboard (Port 3000) to the public internet, you can use **Tailscale** to create a secure, private mesh network between your devices and your server.

This ensures you can access the dashboard from anywhere, but strangers cannot.

1. **Create an Account:** Sign up for a free network at [Tailscale.com](https://tailscale.com/).
2. **Install on your PC/Phone:** Download and log into the Tailscale app on your personal computer.
3. **Install on your Server:** Run the installation script on your Linux VPS:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up
   ```
4. **Access the Dashboard:** Your server now has a private Tailscale IP (e.g., `100.x.x.x`). You can access your dashboard by visiting `http://100.x.x.x:3000` in your web browser.

*Note: Your Teltonika devices still need a public connection! See the Firewall section below.*

## 7. Open the Firewall Ports
Your server needs to allow traffic on port `3000` (for you to view the dashboard) and port `5027` (for the GPS trackers to connect to).

```bash
# If using UFW (Ubuntu default firewall)
sudo ufw allow 3000/tcp
sudo ufw allow 5027/tcp
sudo ufw enable
```

## 7. Point Your Devices to the Server
Now that it's live on the web, you need to configure your Teltonika devices using the Teltonika Configurator software:
- **Server IP:** Enter your new VPS Public IP Address
- **Server Port:** `5027`
- **Protocol:** `TCP`

## 8. Linking a Cloudflare Domain (HTTPS)

To use your custom domain (e.g., `track.yourwebsite.com`) and secure it with HTTPS using Cloudflare, follow these exact steps:

### A. Configure Cloudflare DNS
1. Log into your Cloudflare account and select your domain.
2. Go to the **DNS** tab.
3. Click **Add Record**:
   - **Type:** `A`
   - **Name:** `track` (or `@` for the root domain)
   - **IPv4 address:** Your VPS Public IP Address
   - **Proxy status:** **Proxied** (Orange Cloud turned ON)
4. Click **Save**.

### B. Configure Cloudflare SSL/TLS
1. Go to the **SSL/TLS** tab in Cloudflare.
2. Set your encryption mode to **Flexible**. *(This allows Cloudflare to handle the HTTPS certificate for the user, while communicating with your server over HTTP port 80).*

### C. Install and Configure Nginx on Your Server
We will use Nginx to listen for HTTP web traffic on port 80 and forward it to your Node.js dashboard running on port 3000.

```bash
# Install Nginx
sudo apt install nginx -y

# Remove default configuration
sudo rm /etc/nginx/sites-enabled/default
```

Create a new configuration file for your platform:
```bash
sudo nano /etc/nginx/sites-available/gps-platform
```

Paste the following configuration into the nano editor (replace `track.yourwebsite.com` with your actual domain):
```nginx
server {
    listen 80;
    server_name track.yourwebsite.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        
        # Real IP headers for Cloudflare
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
    }
}
```
Save and exit the file (`Ctrl+O`, `Enter`, `Ctrl+X`).

### D. Enable Nginx and Restart
Activate the configuration and ensure the firewall allows standard web traffic (port 80):

```bash
# Enable the site
sudo ln -s /etc/nginx/sites-available/gps-platform /etc/nginx/sites-enabled/

# Allow Port 80 through the firewall (for Nginx)
sudo ufw allow 80/tcp

# Test Nginx syntax and restart
sudo nginx -t
sudo systemctl restart nginx
```

## 9. How to Update Your Server with New Code
When you make changes to your platform on your personal computer (like changing colors or adding new features), you cannot just refresh the page. You need to send the new files to your VPS and restart the node process.

Here is the easiest workflow using GitHub:

### On Your Personal Computer:
Whenever you finish making changes, upload them to your GitHub repository:
1. Open GitHub Desktop.
2. Type a summary of your changes (e.g., "Changed map color").
3. Click **Commit to main**.
4. Click **Push origin**.

### On Your VPS Server:
Log into your server via SSH, download the new code, and restart the platform seamlessly:
```bash
# 1. Navigate to your project folder
cd /path/to/your/project

# 2. Pull the latest code from your GitHub repository
git pull origin main

# 3. If you added new NPM packages, install them
npm install

# 4. Restart the running platform via PM2
pm2 restart gps-platform
```

Your GPS platform is now running the latest code without losing any tracked vehicle data!
