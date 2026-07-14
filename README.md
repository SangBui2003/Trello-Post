# Tool Upload Facebook

Desktop app Electron + Puppeteer để chuẩn bị bài đăng vào một Facebook Group cố định.

## Chức năng

- Nhập nội dung bài viết.
- Chọn 1 ảnh từ máy.
- Mở Facebook Group được cấu hình sẵn trong `src/config.js`.
- Tự động bấm tạo bài viết, nhập nội dung, tải ảnh lên.
- Dừng ở bước cuối để người dùng tự kiểm tra và nhấn `Đăng`.

## Chạy ứng dụng

```bash
npm install
npm start
```

## Cấu hình

Sửa nhóm Facebook mặc định trong file `src/config.js`:

```js
groupUrl: 'https://www.facebook.com/groups/YOUR_GROUP_ID'
```

## Lưu ý

- Phiên đăng nhập Facebook được lưu trong thư mục dữ liệu của Electron, nên thường chỉ cần đăng nhập một lần.
- Nếu Facebook thay đổi giao diện hoặc aria-label, cần cập nhật selector trong `src/postGroupPoster.js`.
- App chỉ chuẩn bị bài viết. Bước nhấn `Đăng` vẫn do người dùng xác nhận thủ công trong trình duyệt.
