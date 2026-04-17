# 📖 HƯỚNG DẪN SỬ DỤNG - MOCKUP TOOL

> Hệ thống tạo ảnh Mockup & Trade tự động sử dụng AI Gemini, phục vụ đội ngũ thiết kế sản phẩm.

---

## MỤC LỤC

1. [Tổng quan hệ thống](#1-tổng-quan-hệ-thống)
2. [Yêu cầu hệ thống](#2-yêu-cầu-hệ-thống)
3. [Cài đặt & Khởi chạy](#3-cài-đặt--khởi-chạy)
4. [Đăng nhập](#4-đăng-nhập)
5. [Vai trò người dùng](#5-vai-trò-người-dùng)
6. [Thanh điều hướng (Navbar)](#6-thanh-điều-hướng-navbar)
7. [Dashboard - Nhân viên (Mockup/Trade)](#7-dashboard---nhân-viên-mockuptrade)
   - 7.1 [Tạo Job mới](#71-tạo-job-mới)
   - 7.2 [Upload nhiều ảnh cùng lúc](#72-upload-nhiều-ảnh-cùng-lúc)
   - 7.3 [Theo dõi trạng thái Job](#73-theo-dõi-trạng-thái-job)
   - 7.4 [Tải ảnh kết quả](#74-tải-ảnh-kết-quả)
   - 7.5 [Tạo lại ảnh (Regenerate)](#75-tạo-lại-ảnh-regenerate)
   - 7.6 [Xem ảnh phiên bản cũ](#76-xem-ảnh-phiên-bản-cũ)
   - 7.7 [Retry Job lỗi](#77-retry-job-lỗi)
8. [Dashboard - Admin](#8-dashboard---admin)
   - 8.1 [Thẻ thống kê](#81-thẻ-thống-kê)
   - 8.2 [Bộ lọc Jobs](#82-bộ-lọc-jobs)
   - 8.3 [Danh sách Batch](#83-danh-sách-batch)
   - 8.4 [Xóa Batch](#84-xóa-batch)
9. [Quản lý Prompts](#9-quản-lý-prompts)
   - 9.1 [Prompt Group là gì?](#91-prompt-group-là-gì)
   - 9.2 [Tạo Prompt Group mới](#92-tạo-prompt-group-mới)
   - 9.3 [Chỉnh sửa Prompt Group](#93-chỉnh-sửa-prompt-group)
   - 9.4 [Tìm kiếm & Lọc Prompt](#94-tìm-kiếm--lọc-prompt)
   - 9.5 [Xóa Prompt Group](#95-xóa-prompt-group)
10. [Trang VPS - Nhân viên](#10-trang-vps---nhân-viên)
    - 10.1 [Xem thông tin VPS](#101-xem-thông-tin-vps)
    - 10.2 [Đăng nhập tài khoản Gemini](#102-đăng-nhập-tài-khoản-gemini)
    - 10.3 [Thêm tài khoản Gemini mới](#103-thêm-tài-khoản-gemini-mới)
    - 10.4 [Gỡ tài khoản Gemini](#104-gỡ-tài-khoản-gemini)
11. [Quản lý Users (Admin)](#11-quản-lý-users-admin)
    - 11.1 [Tạo User mới](#111-tạo-user-mới)
    - 11.2 [Đổi mật khẩu User](#112-đổi-mật-khẩu-user)
    - 11.3 [Xóa User](#113-xóa-user)
12. [Quản lý Accounts Gemini (Admin)](#12-quản-lý-accounts-gemini-admin)
    - 12.1 [Danh sách tài khoản](#121-danh-sách-tài-khoản)
    - 12.2 [Trạng thái tài khoản](#122-trạng-thái-tài-khoản)
    - 12.3 [Kiểm tra Session (Health Check)](#123-kiểm-tra-session-health-check)
    - 12.4 [Đăng nhập lại tài khoản](#124-đăng-nhập-lại-tài-khoản)
    - 12.5 [Lọc theo trạng thái](#125-lọc-theo-trạng-thái)
13. [Quản lý VPS (Admin)](#13-quản-lý-vps-admin)
    - 13.1 [Thêm VPS Node](#131-thêm-vps-node)
    - 13.2 [Gán User vào VPS](#132-gán-user-vào-vps)
    - 13.3 [Gán Account vào VPS](#133-gán-account-vào-vps)
    - 13.4 [Xem Secret Key](#134-xem-secret-key)
    - 13.5 [Đăng nhập Gemini trên VPS](#135-đăng-nhập-gemini-trên-vps)
    - 13.6 [Thêm Account mới cho VPS](#136-thêm-account-mới-cho-vps)
14. [Cách hệ thống xử lý Job](#14-cách-hệ-thống-xử-lý-job)
    - 14.1 [Luồng xử lý chính](#141-luồng-xử-lý-chính)
    - 14.2 [Hàng đợi FIFO](#142-hàng-đợi-fifo)
    - 14.3 [Cơ chế Retry tự động](#143-cơ-chế-retry-tự-động)
    - 14.4 [Rate Limit & Cooldown](#144-rate-limit--cooldown)
15. [Thông báo Session hết hạn](#15-thông-báo-session-hết-hạn)
16. [Lightbox xem ảnh](#16-lightbox-xem-ảnh)
17. [Cấu trúc thư mục dự án](#17-cấu-trúc-thư-mục-dự-án)
18. [Câu hỏi thường gặp (FAQ)](#18-câu-hỏi-thường-gặp-faq)

---

## 1. Tổng quan hệ thống

**Mockup Tool** là hệ thống tạo ảnh mockup sản phẩm tự động sử dụng AI **Google Gemini**. Nhân viên chỉ cần upload ảnh gốc sản phẩm, chọn bộ prompt (chủ đề/góc chụp), và hệ thống sẽ tự động tạo ra các ảnh mockup chuyên nghiệp.

### Kiến trúc hệ thống:

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│  Frontend    │────▶│  Backend    │────▶│  VPS Agents  │
│  (Next.js)  │◀────│  (Express)  │◀────│  (Python)    │
│  Port 3000  │     │  Port 4000  │     │  Port 5001   │
└─────────────┘     └──────┬──────┘     └──────┬───────┘
                           │                    │
                     ┌─────┴──────┐      ┌─────┴──────┐
                     │  SQLite DB │      │ Gemini AI  │
                     └────────────┘      └────────────┘
```

### Các tính năng chính:
- **Tạo mockup tự động** từ ảnh sản phẩm + prompt AI
- **Hỗ trợ 2 role:** Mockup (ảnh mockup nhiều góc) và Trade (ảnh trade đơn)
- **Xử lý hàng loạt** (batch) — nhiều góc trong 1 phiên Gemini
- **Upload nhiều ảnh** cùng lúc
- **Tạo lại ảnh** (regenerate) với yêu cầu bổ sung
- **Tải ảnh HD 2K** chất lượng cao
- **Hàng đợi thông minh** — FIFO, tự retry khi lỗi
- **Quản lý VPS phân tán** — nhiều máy chủ chạy song song
- **Giám sát realtime** — trạng thái job cập nhật tức thì

---

## 2. Yêu cầu hệ thống

### Server Backend:
- **Node.js** >= 18
- **npm** >= 9
- **SQLite** (tích hợp sẵn qua `better-sqlite3`)
- **sharp** (xử lý ảnh)

### Server VPS Agent:
- **Python** >= 3.10
- **Node.js** >= 18 (chạy agent server)
- **Google Chrome** (automation)
- **noVNC** (để đăng nhập Gemini qua trình duyệt)

### Trình duyệt Client:
- Chrome/Edge/Firefox phiên bản mới nhất
- Hỗ trợ **File System Access API** (để tải ảnh vào thư mục) — Chrome/Edge khuyến nghị

---

## 3. Cài đặt & Khởi chạy

### Bước 1: Clone dự án
```bash
git clone <repo-url>
cd mockup-tool
```

### Bước 2: Cài đặt Backend
```bash
cd backend
npm install
```

### Bước 3: Tạo tài khoản Admin mặc định
```bash
npm run seed
# Output: Created admin user: admin / admin123
```

### Bước 4: Khởi chạy Backend
```bash
npm start            # Production
# hoặc
npm run dev          # Development (auto-reload)
```
Backend sẽ chạy tại **http://localhost:4000**

### Bước 5: Cài đặt & Build Frontend
```bash
cd ../frontend
npm install
npm run build        # Build production
npm start            # Chạy production server
# hoặc
npm run dev          # Development
```
Frontend sẽ chạy tại **http://localhost:3000**

### Bước 6 (Tùy chọn): Sử dụng PM2
```bash
pm2 start backend/src/index.js --name backend
pm2 start npm --name frontend -- start --prefix frontend
```

---

## 4. Đăng nhập

### Truy cập
Mở trình duyệt, vào địa chỉ hệ thống (VD: `http://172.16.0.23:3000` hoặc domain đã cấu hình).

### Màn hình đăng nhập
Giao diện đăng nhập đơn giản gồm:
- **Tên đăng nhập:** Nhập username được admin cấp
- **Mật khẩu:** Nhập password

Nhấn **"Đăng nhập"** để vào hệ thống.

### Tài khoản mặc định (lần đầu)
| Username | Password | Vai trò |
|----------|----------|---------|
| admin    | admin123 | Admin   |

> ⚠️ **Quan trọng:** Hãy đổi mật khẩu admin ngay sau lần đăng nhập đầu tiên.

### Lỗi đăng nhập
Nếu sai thông tin, hệ thống hiển thị:
- `"Đăng nhập thất bại"` — sai username hoặc password
- Tài khoản bị khóa sẽ không thể đăng nhập

---

## 5. Vai trò người dùng

Hệ thống có **3 vai trò**:

| Vai trò | Mô tả | Truy cập |
|---------|--------|----------|
| **Admin** | Quản trị viên toàn quyền | Dashboard admin, Users, Accounts, VPS, Prompts |
| **Mockup** | Nhân viên tạo ảnh mockup nhiều góc | Dashboard user, Prompts (mockup), VPS cá nhân |
| **Trade** | Nhân viên tạo ảnh trade đơn | Dashboard user, Prompts (trade), VPS cá nhân |

### Phân quyền chi tiết:
- **Admin** thấy **tất cả** prompt groups (mockup + trade)
- **Mockup** chỉ thấy prompt groups có role = `mockup`
- **Trade** chỉ thấy prompt groups có role = `trade`
- Mỗi user chỉ thấy **job của mình** (Admin thấy tất cả)
- **Admin** có thể chỉnh sửa mọi prompt group; user chỉ chỉnh group do mình tạo

---

## 6. Thanh điều hướng (Navbar)

Thanh điều hướng cố định ở đầu trang, gồm:

### Với Admin:
| Menu | Chức năng |
|------|-----------|
| **Dashboard** | Tổng quan hệ thống, giám sát jobs |
| **Quản lý Prompts** | CRUD prompt groups & prompts |
| **Accounts** | Quản lý tài khoản Gemini |
| **Users** | Quản lý người dùng |
| **VPS** | Quản lý máy chủ VPS |

### Với Mockup/Trade:
| Menu | Chức năng |
|------|-----------|
| **Dashboard** | Upload ảnh, tạo job, xem kết quả |
| **Quản lý Prompts** | Tạo/chỉnh sửa prompt groups |
| **VPS** | Quản lý tài khoản Gemini trên VPS |

### Góc phải:
- Tên user + vai trò hiện tại
- Nút **Đăng xuất**

### 🔔 Thông báo Session hết hạn (Admin)
Khi có tài khoản Gemini bị hết session, biểu tượng chuông sẽ hiển thị số lượng alert. Click vào để xem danh sách email bị ảnh hưởng.

---

## 7. Dashboard - Nhân viên (Mockup/Trade)

Đây là trang chính mà nhân viên sử dụng hàng ngày.

### 7.1 Tạo Job mới

#### Bước 1: Upload ảnh gốc
- Kéo thả ảnh vào ô **"Ảnh gốc"** hoặc click để chọn file
- Hỗ trợ định dạng: **JPG, PNG, WEBP, JFIF**
- Kích thước tối đa: **20MB** mỗi ảnh
- Ảnh sẽ hiển thị preview sau khi chọn

#### Bước 2: Chọn Chủ đề (Prompt Group)
- Nhấn dropdown **"Chọn Chủ đề"**
- Danh sách chỉ hiển thị các prompt group phù hợp với vai trò của bạn
  - Mockup → thấy các group role `mockup`
  - Trade → thấy các group role `trade`
- Mỗi group có thể chứa nhiều prompt (VD: Góc 1, Góc 2, Góc 3, Góc 4)

#### Bước 3: Nhấn "Upload & Tạo Mockup" (hoặc "Upload & Tạo Trade")
- Hệ thống tạo **1 job cho mỗi prompt** trong group đã chọn
- Tất cả jobs cùng 1 ảnh gốc được gom thành **1 batch**
- Batch sẽ vào hàng đợi và tự động xử lý

#### Ví dụ:
> Chọn group "4 Góc Mockup" có 4 prompts → Hệ thống tạo 4 jobs, xử lý tuần tự trong 1 phiên Gemini.

### 7.2 Upload nhiều ảnh cùng lúc

- Bạn có thể chọn **nhiều ảnh** cùng lúc (giữ Ctrl/Shift khi chọn file)
- Mỗi ảnh sẽ tạo **1 batch riêng** với cùng prompt group
- Preview hiển thị dạng grid nhỏ cho tất cả ảnh đã chọn

### 7.3 Theo dõi trạng thái Job

Phía dưới khu vực upload là **"Lịch sử Jobs"** hiển thị các batch gần đây.

#### Các trạng thái:

| Trạng thái | Biểu tượng | Ý nghĩa |
|------------|------------|---------|
| **Chờ** (pending) | 🕐 Đồng hồ xám | Job đang trong hàng đợi, chưa được xử lý |
| **Đang xử lý** (processing) | 🔄 Spinner xanh | Job đang được Gemini AI tạo ảnh |
| **Hoàn tất** (done) | ✅ Badge xanh lá | Ảnh đã tạo xong, sẵn sàng tải về |
| **Lỗi** (error) | ❌ Badge đỏ | Có lỗi xảy ra, xem chi tiết lỗi |

#### Cập nhật realtime:
- Khi có job đang xử lý, trang tự động cập nhật mỗi **2 giây**
- Khi không có job active, cập nhật mỗi **5 giây**
- Bạn cũng có thể nhấn **"↻ Refresh"** để cập nhật thủ công

#### Hiển thị batch:
- **Batch nhiều jobs:** Hiển thị thumbnail ảnh gốc, thanh progress, và grid kết quả (4 cột cho mockup, 1 cột cho line drawing)
- **Job đơn (trade):** Hiển thị 2 cột: ảnh gốc bên trái, ảnh kết quả bên phải

### 7.4 Tải ảnh kết quả

#### Tải 1 ảnh:
1. Di chuột vào ảnh kết quả đã hoàn tất
2. Nhấn icon **tải xuống** (↓) ở góc ảnh
3. Chọn nơi lưu file — ảnh sẽ được tải ở **độ phân giải 2K HD** (2048px)

#### Tải cả batch:
1. Khi tất cả jobs trong batch hoàn tất, nút **"Tải [N] ảnh"** xuất hiện
2. Nhấn nút → Chọn **thư mục** lưu (trình duyệt Chrome/Edge)
3. Tất cả ảnh HD 2K sẽ được tải vào thư mục đó
4. Hiển thị thông báo "Đã lưu X ảnh thành công!"

> 💡 **Gợi ý:** Sử dụng Chrome hoặc Edge để có trải nghiệm tải thư mục tốt nhất (File System Access API). Firefox sẽ tải từng file riêng lẻ.

### 7.5 Tạo lại ảnh (Regenerate)

Khi ảnh kết quả chưa ưng ý, bạn có thể yêu cầu tạo lại:

1. Nhấn nút **"Tạo lại"** (🔄) trên job đã hoàn tất
2. Một ô nhập text xuất hiện: **"Nhập yêu cầu bổ sung..."**
3. Mô tả chi tiết bạn muốn thay đổi gì
   - VD: `"Thêm ánh sáng ấm hơn, nền xanh lá"`, `"Chỉnh góc nghiêng hơn"`
4. Nhấn **"Gửi"** (nút mũi tên)
5. Ảnh cũ được lưu vào phiên bản cũ, ảnh mới bắt đầu tạo

#### Cách hệ thống xử lý regen:
- Job regen **vào hàng đợi** giống job thường
- Nếu tài khoản Gemini đang bận, regen sẽ **chờ** cho đến khi tài khoản rảnh
- Thứ tự FIFO: batch nào vào trước xử lý trước, regen xếp sau

#### Hai trường hợp regen:
1. **Có conversation URL** (job batch trước đó): AI tiếp tục cuộc hội thoại cũ → hiểu ngữ cảnh tốt hơn
2. **Không có conversation URL** (job đơn): AI tạo phiên mới với prompt gốc + yêu cầu bổ sung

### 7.6 Xem ảnh phiên bản cũ

Khi bạn đã tạo lại ảnh, các phiên bản cũ được lưu lại:

1. Nhấn **"Xem phiên bản cũ"** trên job card
2. Danh sách thumbnail các ảnh trước đó hiển thị bên dưới
3. Nhấn vào thumbnail để xem ảnh lớn
4. Nhấn **"Dùng ảnh này"** để khôi phục ảnh phiên bản cũ thay thế ảnh hiện tại

### 7.7 Retry Job lỗi

Khi job bị lỗi:

1. Thông báo lỗi hiển thị trên job card (VD: "Rate limited", "VPS offline")
2. Nhấn nút **"Thử lại"** trên job lỗi
3. Job sẽ reset về trạng thái "Chờ" và vào hàng đợi

> 💡 Hệ thống tự động retry tối đa **5 lần** cho job đơn, **3 lần** cho batch trước khi báo lỗi cuối cùng.

### Phân trang
- Mỗi trang hiển thị **5 batch** gần nhất
- Dùng nút « ‹ 1 2 3 › » để chuyển trang

---

## 8. Dashboard - Admin

Admin thấy dashboard dạng **tổng quan hệ thống** thay vì form upload.

### 8.1 Thẻ thống kê

4 thẻ thông tin ở đầu trang:

| Thẻ | Nội dung |
|-----|----------|
| 👥 **Users** | Tổng số user, số mockup và trade |
| 📋 **Jobs hôm nay** | Số job hôm nay / tổng cộng |
| ⏳ **Đang xử lý** | Số job pending, số job lỗi |
| 🤖 **Gemini Accounts** | Số account free / tổng, busy, disabled |

Thẻ thống kê tự động cập nhật mỗi **10 giây**.

### 8.2 Bộ lọc Jobs

Bộ lọc phía trên danh sách jobs:

| Lọc | Tùy chọn |
|-----|----------|
| **User** | Dropdown tất cả user (loại trừ admin) |
| **Role** | Tất cả / Mockup / Trade |
| **Trạng thái** | Chờ / Đang xử lý / Hoàn tất / Lỗi |

Nhấn **"↻ Refresh"** để cập nhật ngay.

### 8.3 Danh sách Batch

Jobs hiển thị dạng **batch** — mỗi batch là 1 dòng có thể mở rộng:
- **Thu gọn:** Hiện thumbnail ảnh gốc, tên user, số prompts, trạng thái tổng, thời gian
- **Mở rộng (click):** Hiện grid chi tiết từng job trong batch:
  - Ảnh kết quả (mockup hiển thị 4 cột, line drawing 1 cột rộng)
  - Trạng thái từng job
  - Nút retry cho job lỗi
  - Click ảnh để xem fullscreen (lightbox)

### 8.4 Xóa Batch

1. Nhấn icon **thùng rác** (🗑️) ở góc phải row batch
2. Xác nhận "Xóa batch này và tất cả ảnh liên quan?"
3. Batch và toàn bộ ảnh (gốc + kết quả) bị xóa

Ngoài ra, nếu batch có job lỗi, nút **"Tạo lại"** xuất hiện để retry các job lỗi.

### Phân trang
Admin xem **30 jobs** mỗi trang.

---

## 9. Quản lý Prompts

Truy cập: **Thanh menu → "Quản lý Prompts"**

### 9.1 Prompt Group là gì?

- **Prompt Group** = 1 bộ template chỉ dẫn cho AI
- Mỗi group có thể chứa **nhiều prompt** (VD: Góc 1, Góc 2, Góc 3, Góc 4)
- Khi tạo job, user chọn **1 group** → hệ thống tạo **1 job per prompt**

#### Thuộc tính của Prompt Group:

| Thuộc tính | Mô tả |
|-----------|-------|
| **Tên** | Tên nhóm (VD: "4 Góc Studio", "Trade Basic") |
| **Role** | `mockup` hoặc `trade` — xác định ai thấy group này |
| **Image Style** | Phong cách ảnh (VD: "Chân dung dịu nhẹ") — truyền cho AI |
| **Owner** | User tạo group (admin thấy tất cả) |

#### Thuộc tính của mỗi Prompt:

| Thuộc tính | Mô tả |
|-----------|-------|
| **Tên** | Tên prompt (VD: "Góc 1", "Trade Prompt") |
| **Nội dung** | Đoạn text chi tiết gửi cho Gemini AI |
| **Mode** | `mockup` (ảnh mockup) hoặc `line_drawing` (ảnh nét vẽ) |

### 9.2 Tạo Prompt Group mới

1. Nhấn **"Thêm Group"** (nút xanh góc phải)
2. Điền thông tin:
   - **Tên group**: Đặt tên mô tả (VD: "4 Góc Ngoại Thất")
   - **Role** (Admin): Chọn `mockup` hoặc `trade`
3. Hệ thống tự tạo sẵn các prompt mẫu:
   - Role **mockup** → 4 prompts (Góc 1→4)
   - Role **trade** → 1 prompt (Trade Prompt)
4. Điền **nội dung** cho từng prompt — đây là text sẽ gửi cho Gemini AI
5. Chọn **mode** cho mỗi prompt:
   - `mockup` — tạo ảnh mockup bình thường
   - `line_drawing` — tạo ảnh nét vẽ (line art cho sản xuất)
6. Nhấn **"Lưu"**

#### Thêm/xóa prompt trong group:
- Nhấn **"+ Thêm prompt"** để thêm prompt mới
- Nhấn **icon xóa (🗑️)** cạnh prompt để bỏ (cần ít nhất 1 prompt)

### 9.3 Chỉnh sửa Prompt Group

1. Nhấn vào tên group trong danh sách để **mở rộng**
2. Nhấn **"Sửa"** (icon bút ✏️)
3. Chỉnh sửa tên group, nội dung từng prompt, mode
4. Nhấn **"Lưu"** để cập nhật

> ⚠️ Nhân viên chỉ chỉnh được group **do mình tạo**. Admin chỉnh được **tất cả**.

### 9.4 Tìm kiếm & Lọc Prompt

| Bộ lọc | Mô tả |
|--------|--------|
| **Ô tìm kiếm** | Tìm theo tên group (debounce 300ms) |
| **Tab "Tất cả" / "Của tôi"** | Lọc theo ownership (user) |
| **Lọc theo User** (Admin) | Dropdown chọn user cụ thể |
| **Lọc theo Role** (Admin) | Mockup / Trade |

### 9.5 Xóa Prompt Group

1. Nhấn icon **thùng rác** cạnh group
2. Xác nhận xóa
3. Group và toàn bộ prompts bên trong bị xóa vĩnh viễn

---

## 10. Trang VPS - Nhân viên

Truy cập: **Thanh menu → "VPS"**

Nhân viên thấy thông tin VPS mà admin đã gán cho mình.

### 10.1 Xem thông tin VPS

Hiển thị:
- **Tên VPS** (VD: "VPS-trade-1")
- **Trạng thái:** Online/Offline
- **Heartbeat:** Thời gian ping cuối cùng
- **Max workers:** Số job chạy đồng thời tối đa

Phía dưới là danh sách **tài khoản Gemini** trên VPS:
- Email
- Trạng thái: Sẵn sàng / Đang dùng / Cooldown / Hết session

> Nếu chưa được gán VPS, hiển thị thông báo "Chưa được gán VPS — liên hệ admin."

### 10.2 Đăng nhập tài khoản Gemini

Khi tài khoản Gemini bị **hết session** (status: Hết session), bạn cần đăng nhập lại:

1. Nhấn nút **"Đăng nhập"** cạnh tài khoản cần login
2. Hệ thống mở trình duyệt Chrome trên VPS và hiển thị qua **noVNC**
3. Cửa sổ noVNC xuất hiện — bạn thấy trang đăng nhập Google
4. **Thao tác thủ công:** Nhập email + password Google, xử lý xác thực 2 bước
5. Sau khi đăng nhập xong, hệ thống tự kiểm tra cookies
6. Hiển thị số **auth cookies** tìm thấy
7. Nhấn **"Xong"** để lưu cookies
8. Trạng thái tài khoản chuyển thành **"Sẵn sàng"**

> 💡 **Lưu ý:** Quá trình đăng nhập Google hoàn toàn thủ công. Hệ thống chỉ điều khiển mở/đóng trình duyệt và lưu cookies.

### 10.3 Thêm tài khoản Gemini mới

1. Nhấn **"+ Thêm Account"**
2. Nhập email Google
3. Nhấn **"Thêm"**
4. Tiến hành đăng nhập theo bước 10.2

### 10.4 Gỡ tài khoản Gemini

1. Nhấn icon **xóa** cạnh tài khoản
2. Xác nhận "Gỡ [email] khỏi VPS?"
3. Tài khoản bị xóa khỏi VPS

---

## 11. Quản lý Users (Admin)

Truy cập: **Thanh menu → "Users"** (Admin only)

### 11.1 Tạo User mới

1. Nhấn **"Thêm User"**
2. Điền thông tin:
   | Trường | Mô tả |
   |--------|--------|
   | **Tên đăng nhập** | Unique, không trùng |
   | **Mật khẩu** | Tối thiểu cần đặt đủ mạnh |
   | **Vai trò** | `mockup` hoặc `trade` |
3. Nhấn **"Tạo"**

### 11.2 Đổi mật khẩu User

1. Nhấn icon **chìa khóa** (🔑) cạnh user
2. Nhập mật khẩu mới
3. Nhấn **"Đổi mật khẩu"**
4. Hiển thị "Đổi mật khẩu thành công!"

### 11.3 Xóa User

1. Nhấn icon **thùng rác** cạnh user
2. Xác nhận "Xóa user này?"
3. User bị xóa vĩnh viễn

> ⚠️ Không thể xóa chính mình (tài khoản đang đăng nhập).

---

## 12. Quản lý Accounts Gemini (Admin)

Truy cập: **Thanh menu → "Accounts"** (Admin only)

### 12.1 Danh sách tài khoản

Bảng hiển thị tất cả tài khoản Gemini trong hệ thống:

| Cột | Mô tả |
|-----|--------|
| **Email** | Địa chỉ Gmail |
| **Trạng thái** | Badge màu hiển thị status |
| **VPS** | Tên VPS mà account được gán |
| **Lần dùng cuối** | Thời gian gần nhất account được dùng |

### 12.2 Trạng thái tài khoản

| Trạng thái | Badge | Ý nghĩa |
|------------|-------|---------|
| **Sẵn sàng** (free) | 🟢 Xanh lá | Account rảnh, sẵn sàng nhận job |
| **Đang dùng** (busy) | 🔵 Xanh dương | Đang xử lý job |
| **Cooldown** | 🟡 Vàng | Nghỉ giữa 2 batch (2 giây) |
| **Hết session** (disabled) | 🔴 Đỏ | Cookie hết hạn, cần đăng nhập lại |
| **Hết lượt tạo ảnh** (rate_limited) | ⛔ Đỏ | Gemini giới hạn tạo ảnh, chờ ~24h |

### 12.3 Kiểm tra Session (Health Check)

Khi trang Accounts mở, hệ thống **tự động** kiểm tra session tất cả tài khoản.

Kiểm tra thủ công:
1. Nhấn **"Kiểm tra"** trên tài khoản cụ thể
2. Hoặc nhấn **"Kiểm tra tất cả"** ở đầu trang
3. Kết quả hiển thị dưới mỗi tài khoản:
   - ✅ "Logged in as [email]" → Session OK
   - ❌ "Session expired" → Cần đăng nhập lại

### 12.4 Đăng nhập lại tài khoản

Tương tự mục 10.2 — sử dụng noVNC interface.

### 12.5 Lọc theo trạng thái

Dropdown lọc nhanh:
- Tất cả
- Sẵn sàng
- Đang dùng
- Cooldown
- Hết session
- Hết lượt tạo ảnh

---

## 13. Quản lý VPS (Admin)

Truy cập: **Thanh menu → "VPS"** (Admin only)

### 13.1 Thêm VPS Node

1. Nhấn **"Thêm VPS"**
2. Điền thông tin:

   | Trường | Mô tả | Ví dụ |
   |--------|--------|-------|
   | **Tên** | Tên gợi nhớ | VPS-trade-1 |
   | **Host** | Địa chỉ IP hoặc hostname | 172.16.0.25 |
   | **Port** | Port agent server | 5001 |
   | **Max concurrent** | Số worker chạy đồng thời | 3 |

3. Nhấn **"Lưu"**
4. Hệ thống tự tạo **Secret Key** (API key) cho VPS

### 13.2 Gán User vào VPS

Mỗi user cần được gán vào 1 VPS để hệ thống biết dispatch job đến đâu:

1. Nhấn **"Gán Users"** trên VPS card
2. Tick chọn các user muốn gán
3. Nhấn **"Lưu"**
4. User sẽ thấy VPS của mình tại trang VPS cá nhân

### 13.3 Gán Account vào VPS

Mỗi tài khoản Gemini cần gán vào VPS nơi nó sẽ chạy:

1. Nhấn **"Gán Accounts"** trên VPS card
2. Tick chọn các tài khoản Gemini
3. Nhấn **"Lưu"**

### 13.4 Xem Secret Key

1. Nhấn **"Xem Key"** trên VPS card
2. Hiển thị Secret Key (ẩn mặc định)
3. Nhấn **"Sao chép"** để copy vào clipboard
4. Key này cần cấu hình trên file agent server của VPS

### 13.5 Đăng nhập Gemini trên VPS

Tương tự mục 10.2 — Admin cũng có giao diện login noVNC cho mỗi account trên VPS.

### 13.6 Thêm Account mới cho VPS

1. Nhấn **"+ Thêm Account"** trên VPS card
2. Nhập email Google
3. Nhấn **"Thêm"**
4. Account mới tự động gán vào VPS đó

### Trạng thái VPS

| Trạng thái | Ý nghĩa |
|-----------|---------|
| 🟢 **Online** | Agent server đang chạy, heartbeat OK |
| 🔴 **Offline** | Không nhận được heartbeat |

Heartbeat tự cập nhật mỗi **30 giây**.

---

## 14. Cách hệ thống xử lý Job

### 14.1 Luồng xử lý chính

```
User upload ảnh + chọn group
        │
        ▼
Backend tạo jobs (1 per prompt)
        │
        ▼
Jobs vào hàng đợi (batches Map)
        │
        ▼
Hệ thống chọn account Gemini rảnh
        │
        ▼
Sync cookies đến VPS
        │
        ▼
Dispatch job đến VPS Agent
        │
        ▼
VPS Agent mở Chrome → Gemini AI tạo ảnh
        │
        ▼
VPS callback kết quả về Backend
        │
        ▼
Backend lưu ảnh, cập nhật status → Frontend hiển thị
```

### 14.2 Hàng đợi FIFO

- **FIFO** (First In, First Out): Batch nào vào trước xử lý trước
- Batch được sắp xếp theo `minJobId` (ID nhỏ nhất = tạo sớm nhất)
- Job **regenerate** luôn xếp SAU các batch thường (dùng timestamp làm priority)
- Mỗi account Gemini chỉ xử lý **1 batch tại 1 thời điểm**
- Khi account rảnh → batch tiếp theo trong hàng đợi được bắt đầu

### 14.3 Cơ chế Retry tự động

| Loại | Số lần retry | Delay |
|------|-------------|-------|
| **Job đơn** | Tối đa 5 lần | 5s, 10s, 7s, 8s, 5s |
| **Batch** | Tối đa 3 lần | 8s mỗi lần |

Khi retry, batch chuyển sang **account khác** (nếu có) để tránh lỗi lặp.

### 14.4 Rate Limit & Cooldown

- **Cooldown:** Sau mỗi batch xong, account nghỉ **2 giây** trước khi nhận batch mới
- **Rate Limit:** Khi Gemini giới hạn tạo ảnh, account bị đánh dấu rate_limited **~24 giờ**
  - Job tự chuyển sang account khác (nếu có)
  - Nếu không còn account → job chờ trong hàng đợi

---

## 15. Thông báo Session hết hạn

Hệ thống tự động phát hiện khi tài khoản Gemini bị hết session:

- **Admin** thấy icon 🔔 chuông đỏ trên Navbar với số lượng alert
- Click vào chuông → xem danh sách email bị ảnh hưởng
- Admin cần vào **Accounts** → **Đăng nhập lại** cho account đó

Session thường hết hạn sau vài ngày không sử dụng. Kiểm tra định kỳ bằng Health Check.

---

## 16. Lightbox xem ảnh

Click vào bất kỳ ảnh nào (gốc hoặc kết quả) sẽ mở **Lightbox** toàn màn hình:

- Ảnh hiển thị full-size
- Nút **tải xuống** (↓) để download ảnh HD
- Nút **đóng** (×) hoặc nhấn bên ngoài ảnh để đóng
- Hỗ trợ cuộn zoom trên mobile

---

## 17. Cấu trúc thư mục dự án

```
mockup-tool/
├── backend/                    # Express.js API server
│   ├── package.json
│   ├── mockup.db              # SQLite database (tự tạo)
│   └── src/
│       ├── index.js           # Entry point (port 4000)
│       ├── db.js              # Database schema & migrations
│       ├── seed.js            # Tạo admin mặc định
│       ├── middleware/
│       │   └── auth.js        # JWT authentication
│       ├── routes/
│       │   ├── auth.js        # POST /api/auth/login
│       │   ├── jobs.js        # CRUD jobs, upload, retry, regen
│       │   ├── prompts.js     # CRUD prompt groups & prompts
│       │   ├── accounts.js    # Quản lý tài khoản Gemini
│       │   ├── users.js       # Quản lý users
│       │   └── settings.js    # Cài đặt hệ thống
│       └── services/
│           └── jobRunner.js   # Hàng đợi, dispatch VPS, callbacks
│
├── frontend/                   # Next.js 16 frontend
│   └── src/
│       ├── app/
│       │   ├── login/         # Trang đăng nhập
│       │   ├── dashboard/     # Dashboard (admin & user)
│       │   ├── prompts/       # Quản lý prompts
│       │   ├── vps/           # VPS cá nhân (user)
│       │   └── admin/
│       │       ├── accounts/  # Quản lý accounts (admin)
│       │       ├── users/     # Quản lý users (admin)
│       │       └── vps/       # Quản lý VPS (admin)
│       ├── components/        # Shared components
│       └── lib/               # API client, auth context
│
├── automation/                 # Python automation scripts
├── uploads/                    # Ảnh gốc upload
├── outputs/                    # Ảnh kết quả
└── cookies/                    # Gemini session cookies
```

---

## 18. Câu hỏi thường gặp (FAQ)

### Q: Job bị lỗi "Rate limited" là sao?
**A:** Google Gemini giới hạn số lượng ảnh tạo mỗi ngày. Tài khoản bị rate limit sẽ tự hết hạn sau ~24h. Hệ thống tự chuyển sang tài khoản khác nếu có.

### Q: Job bị "Session expired" là sao?
**A:** Cookie đăng nhập Gemini đã hết hạn. Cần vào trang VPS → Đăng nhập lại tài khoản Gemini bị ảnh hưởng.

### Q: Tại sao job hiển thị "Chờ" lâu?
**A:** Có thể do:
1. Đang có batch khác chạy trước (hàng đợi FIFO)
2. Tất cả tài khoản Gemini đang bận
3. Tài khoản Gemini bị rate limited — kiểm tra trang Accounts

### Q: Ảnh kết quả bị mờ/xấu?
**A:** Thử:
1. **Tạo lại** (Regenerate) với yêu cầu cụ thể hơn
2. Tải ảnh **2K HD** thay vì ảnh thường
3. Chỉnh sửa nội dung prompt cho chi tiết hơn

### Q: Máy đang chạy batch, tôi có thể tạo thêm batch mới không?
**A:** Có! Batch mới sẽ vào hàng đợi và tự động chạy khi tài khoản rảnh. Thứ tự FIFO được đảm bảo.

### Q: Trade khác gì Mockup?
**A:**
- **Mockup:** Tạo ảnh mockup nhiều góc (thường 4 góc) trong 1 phiên Gemini — các góc nhất quán vì cùng conversation
- **Trade:** Tạo 1 ảnh trade đơn lẻ — mỗi ảnh là 1 job độc lập

### Q: Làm sao biết VPS đang online?
**A:** Trang VPS hiện badge 🟢 Online / 🔴 Offline. Heartbeat tự cập nhật mỗi 30 giây.

### Q: Tôi quên mật khẩu?
**A:** Liên hệ Admin để được reset mật khẩu tại trang Users → icon 🔑.

### Q: Line Drawing là gì?
**A:** Chế độ tạo ảnh nét vẽ đen trắng từ ảnh mockup, dùng cho sản xuất thực tế. Prompt line drawing được cấu hình riêng.

---

> 📝 **Phiên bản tài liệu:** 1.0  
> **Cập nhật lần cuối:** Tháng 4, 2026  
> **Dự án:** Mockup Tool - Smazing
