import requests
import time
import random

# 配置信息
SERVER_URL = "http://8.153.166.60:8080/update" # 替换为你的服务器实际IP
DRIVER_ID = "Tesla_Model_Y_001"

# 初始坐标：上海外滩附近 (经度, 纬度)
# 这个点在禁行区边缘，方便观察闯入效果
start_lng, start_lat = 121.481, 31.231 

def run_simulation():
    current_lng, current_lat = start_lng, start_lat
    print(f"🚀 模拟启动！司机: {DRIVER_ID}")
    print(f"📍 初始位置: {current_lng}, {current_lat}")

    while True:
        try:
            # 1. 模拟车辆移动 (随机向东北方向移动一点点)
            current_lng += random.uniform(0.0001, 0.0005)
            current_lat += random.uniform(0.0001, 0.0005)

            # 2. 构造请求参数
            params = {
                "id": DRIVER_ID,
                "lng": round(current_lng, 6),
                "lat": round(current_lat, 6)
            }

            # 3. 发送数据到 Go 后端
            response = requests.get(SERVER_URL, params=params, timeout=5)
            
            if response.status_code == 200:
                # 打印后端返回的 JSON 结果（包含告警信息）
                print(f"✅ 发送成功 | 坐标: {params['lng']}, {params['lat']} | 响应: {response.text}")
            else:
                print(f"❌ 发送失败 | 状态码: {response.status_code}")

        except Exception as e:
            print(f"⚠️ 网络连接异常: {e}")

        # 每 3 秒发送一次，与前端刷新频率一致
        time.sleep(3)

if __name__ == "__main__":
    run_simulation()