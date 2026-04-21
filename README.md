# mockup-tool

Mockup tool with Express.js backend, Next.js frontend, and Playwright automation for Gemini.

## Project Structure

```
mockup-tool/
├── backend/          ← Express.js API server
├── frontend/         ← Next.js web UI
├── agent/            ← Agent chạy trên mỗi VPS (Node.js + Python)
├── automation/       ← Playwright (Python) xử lý Gemini
├── cookies/          ← Cookie tài khoản Gemini (git ignored)
├── uploads/          ← Ảnh upload (git ignored)
├── outputs/          ← Ảnh kết quả (git ignored)
├── .gitignore
└── README.md
```

---

## Kiến trúc hệ thống

```
[Main Server 172.16.0.23]
  ├── backend  (PM2, port 4000) ← Express.js + SQLite
  └── frontend (PM2, port 3000) ← Next.js

[VPS Agent nodes]
  ├── VPS-mockup-1  172.16.0.25  (vps_id=1)
  ├── VPS-trade-1   172.16.0.27  (vps_id=2)
  ├── VPS-mockup-2  172.16.0.28  (vps_id=3)
  ├── VPS-mockup-3  172.16.0.16  (vps_id=4)
  ├── VPS-mockup-4  172.16.0.33  (vps_id=5)
  └── VPS-mockup-5  172.16.0.36  (vps_id=6)
```

- SSH user: `mockup`, password: `123`
- Git repo: `https://github.com/miquann-working/mockup-tool`
- Branch: `main`

---

## 1. Cài đặt Main Server (từ đầu)

> Server Ubuntu 24.04, IP `172.16.0.23`

### 1.1 Cài Node.js 20, PM2, Git

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git
sudo npm install -g pm2
```

### 1.2 Clone repo

```bash
cd /home/mockup
git clone https://github.com/miquann-working/mockup-tool.git
cd mockup-tool
```

### 1.3 Cài dependencies backend

```bash
cd backend
npm install
cd ..
```

### 1.4 Cài dependencies frontend

```bash
cd frontend
npm install
npm run build
cd ..
```

### 1.5 Khởi động

```bash
# Backend
cd /home/mockup/mockup-tool/backend
pm2 start src/index.js --name backend

# Frontend
cd /home/mockup/mockup-tool/frontend
pm2 start npm --name frontend -- start

pm2 save
pm2 startup   # copy lệnh nó in ra rồi chạy
```

### 1.6 Kiểm tra

```bash
pm2 list
curl http://localhost:4000/health
```

---

## 2. Cài đặt VPS Agent (từ đầu)

> VPS Ubuntu 24.04, dùng cho Gemini automation

### 2.1 Cài package cơ bản

```bash
sudo apt update && sudo apt install -y \
  git curl wget python3 python3-pip python3-venv \
  xvfb x11vnc novnc chromium-browser \
  nodejs npm
sudo npm install -g pm2
```

### 2.2 Clone repo

```bash
cd /home/mockup
git clone https://github.com/miquann-working/mockup-tool.git
cd mockup-tool
```

### 2.3 Cài Python venv + Playwright

```bash
python3 -m venv /home/mockup/venv
source /home/mockup/venv/bin/activate
pip install playwright
playwright install chromium
pip install -r automation/requirements.txt
```

### 2.4 Cài Node dependencies cho agent

```bash
cd /home/mockup/mockup-tool/agent
npm install
```

### 2.5 Tạo VPS node trên admin panel

Truy cập `https://mockup.smazing.uk/admin/vps` → Thêm VPS:
- Name: `VPS-mockup-X`
- Host: IP của VPS
- Port: `5001`
- Max concurrent: `3`

Hoặc qua API (chạy từ máy có kết nối backend):

```powershell
$token = (Invoke-RestMethod -Uri "http://172.16.0.23:4000/api/auth/login" -Method Post -ContentType "application/json" -Body '{"username":"admin","password":"admin123"}').token
$result = Invoke-RestMethod -Uri "http://172.16.0.23:4000/api/vps" -Method Post -ContentType "application/json" -Headers @{Authorization="Bearer $token"} -Body '{"name":"VPS-mockup-X","host":"172.16.0.XX","port":5001,"max_concurrent":3}'
$result | ConvertTo-Json  # Ghi lại secret_key
```

### 2.6 Tạo file .env cho agent

```bash
cat > /home/mockup/mockup-tool/agent/.env << 'EOF'
AGENT_PORT=5001
SECRET_KEY=<secret_key từ bước 2.5>
SERVER_URL=http://172.16.0.23:4000
MAX_CONCURRENT=3
PYTHON_BIN=/home/mockup/venv/bin/python3
EOF
```

### 2.7 Khởi động agent

```bash
cd /home/mockup/mockup-tool/agent
pm2 start server.js --name agent
pm2 save
pm2 startup   # copy lệnh in ra rồi chạy
```

### 2.8 Kiểm tra

```bash
pm2 logs agent --lines 20
```

Nếu thấy `[Heartbeat] Started (every 30s)` là thành công.

---

## 3. Tạo VPS mới bằng Clone VM (Hyper-V)

> Nhanh hơn cài từ đầu — copy nguyên disk từ VM có sẵn

### 3.1 Trên Hyper-V host (172.16.1.6), chạy PowerShell

```powershell
# Bước 1: Export VM nguồn (chỉ cần làm 1 lần, giữ lại để clone nhiều lần)
Export-VM -Name "vps-2" -Path "C:\VMs\export-temp"

# Bước 2: Import thành VM mới (thay vps-X bằng tên VM mới, vd: vps-5, vps-6...)
$vmcx = Get-ChildItem "C:\VMs\export-temp\vps-2\Virtual Machines\*.vmcx" | Select-Object -First 1
Import-VM -Path $vmcx.FullName `
  -VirtualMachinePath "C:\VMs\vps-X" `
  -VhdDestinationPath "C:\VMs\vps-X\Virtual Hard Disks" `
  -SnapshotFilePath "C:\VMs\vps-X\Snapshots" `
  -Copy -GenerateNewId

# Bước 3: Đổi tên, start
$newVM = Get-VM | Where-Object { $_.Name -eq "vps-2" -and $_.Path -like "*vps-X*" }
Stop-VM -VM $newVM -Force -TurnOff
Rename-VM -VM $newVM -NewName "vps-X"
Start-VM -Name "vps-X"

# Bước 4: Xem IP (đợi ~1 phút sau khi start)
Get-VM -Name "vps-X" | Select-Object -ExpandProperty NetworkAdapters | Select-Object IPAddresses
# Hoặc mở console: vmconnect.exe localhost "vps-X"
```

### 3.2 Setup VM mới sau khi clone

Sau khi có IP (giả sử `172.16.0.XX`):

```bash
# SSH vào VM mới
ssh mockup@172.16.0.XX   # password: 123

# Xóa cookies và outputs cũ
rm -rf /home/mockup/mockup-tool/agent/cookies/*
rm -rf /home/mockup/mockup-tool/agent/outputs/*

# Pull code mới nhất
cd /home/mockup/mockup-tool
git stash && git pull

# Tạo .env mới với secret_key từ bước tạo VPS node
cat > agent/.env << 'EOF'
AGENT_PORT=5001
SECRET_KEY=<secret_key mới>
SERVER_URL=http://172.16.0.23:4000
MAX_CONCURRENT=3
PYTHON_BIN=/home/mockup/venv/bin/python3
EOF

# Start agent
cd agent
pm2 delete all 2>/dev/null
pm2 start server.js --name agent
pm2 save

# Đổi hostname (tuỳ chọn)
sudo hostnamectl set-hostname vps-mockup-X
```

---

## 4. Thêm tài khoản Gemini vào hệ thống

### 4.1 Tạo tài khoản trên admin panel

1. Vào `https://mockup.smazing.uk/admin/accounts`
2. Nhấn **Thêm tài khoản**
3. Điền:
   - Email: `account@gmail.com`
   - Cookie dir: tự động điền
   - Gán VPS: chọn VPS node muốn dùng

### 4.2 Login tài khoản để tạo cookies

Trên VPS đã gán account, chạy lệnh login:

```bash
ssh mockup@172.16.0.XX

# Login 1 tài khoản
cd /home/mockup/mockup-tool/automation
source /home/mockup/venv/bin/activate
python3 setup_account.py --email account@gmail.com

# noVNC sẽ mở trên port 6080, truy cập từ browser:
# http://172.16.0.XX:6080/vnc.html
# Đăng nhập Google thủ công trong browser đó
```

### 4.3 Kiểm tra cookies sau login

```bash
# Trên agent VPS
pm2 logs agent --lines 30
# Tìm dòng: [Login] Verify account@gmail.com: OK (6/6 auth cookies)
```

---

## 5. Deploy cập nhật code

### Main server

```bash
ssh mockup@172.16.0.23 "cd /home/mockup/mockup-tool && git pull && pm2 restart backend"
```

### Tất cả VPS agents (chạy từng cái)

```bash
ssh mockup@172.16.0.25 "cd /home/mockup/mockup-tool && git stash && git pull && pm2 restart agent"
ssh mockup@172.16.0.27 "cd /home/mockup/mockup-tool && git stash && git pull && pm2 restart agent"
ssh mockup@172.16.0.28 "cd /home/mockup/mockup-tool && git stash && git pull && pm2 restart agent"
ssh mockup@172.16.0.16 "cd /home/mockup/mockup-tool && git stash && git pull && pm2 restart agent"
ssh mockup@172.16.0.33 "cd /home/mockup/mockup-tool && git stash && git pull && pm2 restart agent"
ssh mockup@172.16.0.36 "cd /home/mockup/mockup-tool && git stash && git pull && pm2 restart agent"
```

---

## 6. Xử lý sự cố thường gặp

### Agent offline / không heartbeat

```bash
ssh mockup@172.16.0.XX "pm2 logs agent --lines 30"
ssh mockup@172.16.0.XX "pm2 restart agent"
```

### Tài khoản mất cookies (0/6 auth cookies)

Cần login lại thủ công qua noVNC:
```bash
ssh mockup@172.16.0.XX
cd /home/mockup/mockup-tool/automation
source /home/mockup/venv/bin/activate
python3 setup_account.py --email account@gmail.com
# Truy cập http://172.16.0.XX:6080/vnc.html để login
```

### Jobs bị stuck / pending mãi

```bash
# Restart backend để trigger stuck recovery (tự xử lý sau 5 phút)
ssh mockup@172.16.0.23 "pm2 restart backend"
```
