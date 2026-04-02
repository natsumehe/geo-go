import serial
import time

# 串口路径请根据你的 ls /dev/cu.usb* 实际结果修改
GNSS_PORT = '/dev/cu.usbserial-1140' 
IMU_PORT = '/dev/cu.usbserial-1120' 

def run_sensor_logger():
    try:
        # GNSS 通常是 9600，IMU 通常是 115200
        ser_gnss = serial.Serial(GNSS_PORT, 9600, timeout=1)
        ser_imu = serial.Serial(IMU_PORT, 115200, timeout=1)
        
        # GNSS 保存为 .log (NMEA文本)
        # IMU 保存为 .bin (原始二进制) 或 .hex (十六进制文本)
        with open('gnss_data.log', 'a') as f_gnss, \
             open('imu_data.hex', 'a') as f_imu:
            
            print("正在记录数据... 按 Ctrl+C 停止")
            
            while True:
                # 1. 处理 GNSS 数据
                if ser_gnss.in_waiting:
                    gnss_line = ser_gnss.readline().decode('utf-8', errors='ignore')
                    if gnss_line.strip():
                        f_gnss.write(f"{time.time()}, {gnss_line}")
                
                # 2. 处理 IMU 二进制数据
                if ser_imu.in_waiting:
                    # 读取一块缓冲区数据
                    imu_raw = ser_imu.read(ser_imu.in_waiting)
                    # 将二进制转为十六进制字符串保存，方便后续离线分析
                    f_imu.write(f"{time.time()}, {imu_raw.hex()}\n")
                
                # 防止频繁刷盘影响性能，但要确保数据写入
                f_gnss.flush()
                f_imu.flush()

    except KeyboardInterrupt:
        print("\n停止记录。")
    except Exception as e:
        print(f"发生错误: {e}")
    finally:
        if 'ser_gnss' in locals(): ser_gnss.close()
        if 'ser_imu' in locals(): ser_imu.close()


def run_backup_logger():
    # 使用 try-except 捕捉所有可能的 USB 断开错误
    try:
        ser_gnss = serial.Serial('/dev/cu.usbserial-1120', 9600, timeout=1)
        # 增加一个带时间戳的文件名，防止覆盖
        filename = f"capture_{int(time.time())}.csv"
        
        with open(filename, 'a') as f:
            print(f"数据将保存至 {filename}")
            while True:
                if ser_gnss.in_waiting:
                    line = ser_gnss.readline().decode('utf-8', errors='ignore')
                    if line.strip():
                        f.write(f"{time.time()}, {line}")
                        # 关键：每条数据都强制写入硬盘，防止崩溃丢数据
                        f.flush() 
                time.sleep(0.01)
    except serial.SerialException as e:
        print(f"USB 连接断开或串口错误: {e}")
    except Exception as e:
        print(f"其他错误: {e}")

if __name__ == "__main__":
    run_sensor_logger()
    run_backup_logger()