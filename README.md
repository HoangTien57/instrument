# Instrument

Chơi piano / guitar bằng bàn phím máy tính. Chọn bài, chọn chế độ (Giai điệu / Hợp âm), nhấn **Space** liên tục để phát từng nốt theo lời.

- Chạy: `python server.py` (hoặc double-click `chay.bat`), mở http://localhost:8765
- Thêm bài: nhập tên bài + nghệ sĩ → Claude Code (`claude -p`, có WebSearch/WebFetch) tra nguồn hợp âm / giai điệu và phổ thành `songs/*.json`
- Không lưu lời bài hát; mỗi bài ghi nguồn đã dùng
