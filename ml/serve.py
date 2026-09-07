"""
HTTP server nhỏ để phục vụ prediction cho Node.js backend.

Chạy:  python serve.py
Endpoint: POST http://localhost:5050/predict
Body: { "ward_name": "Cái Khế", "total_items": 3, "num_distinct": 2, "subtotal": 150000 }
"""
import json
from http.server import HTTPServer, BaseHTTPRequestHandler
from predict import DeliveryPredictor
from datetime import datetime

predictor = None


class PredictHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/predict":
            self.send_response(404)
            self.end_headers()
            return

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)

        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Invalid JSON"}).encode())
            return

        now = datetime.now()
        ward_name = data.get("ward_name", "")
        total_items = int(data.get("total_items", 1))
        num_distinct = int(data.get("num_distinct", 1))
        order_hour = int(data.get("order_hour", now.hour))
        day_of_week = int(data.get("day_of_week", now.weekday()))
        subtotal = float(data.get("subtotal", 0))

        result = predictor.predict(
            ward_name=ward_name,
            total_items=total_items,
            num_distinct=num_distinct,
            order_hour=order_hour,
            day_of_week=day_of_week,
            subtotal=subtotal,
        )

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(result).encode())

    def log_message(self, format, *args):
        pass  # Suppress logs


def main():
    global predictor
    predictor = DeliveryPredictor()
    print(f"ML model loaded: {predictor.info['algorithm']} (MAE={predictor.info['mae_minutes']} min)")

    server = HTTPServer(("127.0.0.1", 5050), PredictHandler)
    print("ML prediction server running on http://127.0.0.1:5050")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
