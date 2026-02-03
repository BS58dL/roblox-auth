import { Redis } from '@upstash/redis';

// 手动指定环境变量（避免自动检测失败）
const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// 管理密码（硬编码）
const ADMIN_PASSWORD = 'BS58Admin888!';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { action, key, hwid, adminKey, maxDevices = 2 } = req.body || {};

    // ========== 管理接口：添加卡密 ==========
    if (action === 'admin_add') {
      if (adminKey !== ADMIN_PASSWORD) {
        return res.json({ success: false, msg: '管理密码错误' });
      }
      
      if (!key) return res.json({ success: false, msg: '缺少卡密' });
      
      // 检查是否已存在
      const exists = await redis.get(`key:${key}`);
      if (exists) return res.json({ success: false, msg: '卡密已存在' });
      
      await redis.set(`key:${key}`, {
        devices: [],
        maxDevices: parseInt(maxDevices) || 2,
        created: Date.now()
      });
      
      return res.json({ success: true, msg: `卡密 ${key} 添加成功` });
    }

    // ========== 管理接口：查看所有卡密 ==========
    if (action === 'admin_list') {
      if (adminKey !== ADMIN_PASSWORD) {
        return res.json({ success: false, msg: '管理密码错误' });
      }
      
      const keys = await redis.keys('key:*');
      const list = [];
      
      for (const k of keys) {
        const data = await redis.get(k);
        if (data) {
          list.push({
            key: k.replace('key:', ''),
            boundDevices: data.devices?.length || 0,
            maxDevices: data.maxDevices,
            created: data.created
          });
        }
      }
      
      return res.json({ success: true, count: list.length, data: list });
    }

    // ========== 管理接口：删除卡密 ==========
    if (action === 'admin_del') {
      if (adminKey !== ADMIN_PASSWORD) {
        return res.json({ success: false, msg: '管理密码错误' });
      }
      
      await redis.del(`key:${key}`);
      return res.json({ success: true, msg: `卡密 ${key} 已删除` });
    }

    // ========== 初始化默认卡密（首次使用）==========
    if (action === 'init') {
      const defaultKeys = {
        "BS58-VIP-2024": { maxDevices: 2 },
        "TEST-001": { maxDevices: 1 }
      };
      
      for (const [k, v] of Object.entries(defaultKeys)) {
        const exists = await redis.get(`key:${k}`);
        if (!exists) {
          await redis.set(`key:${k}`, {
            devices: [],
            maxDevices: v.maxDevices,
            created: Date.now()
          });
        }
      }
      return res.json({ success: true, msg: '初始化完成' });
    }

    // ========== 普通验证接口 ==========
    if (!key || !hwid) {
      return res.json({ valid: false, msg: '缺少参数' });
    }

    let keyData = await redis.get(`key:${key}`);
    
    if (!keyData) {
      return res.json({ valid: false, msg: '卡密不存在' });
    }

    if (action === 'verify') {
      if (keyData.devices?.includes(hwid)) {
        return res.json({ 
          valid: true, 
          msg: '验证通过',
          deviceNum: keyData.devices.length 
        });
      } else if (keyData.devices.length < keyData.maxDevices) {
        return res.json({ 
          valid: false, 
          canBind: true, 
          msg: '未绑定此设备',
          currentDevices: keyData.devices.length,
          maxDevices: keyData.maxDevices
        });
      } else {
        return res.json({ 
          valid: false, 
          msg: `已达到最大绑定数(${keyData.maxDevices}台)` 
        });
      }
    }
    
    if (action === 'bind') {
      if (keyData.devices.includes(hwid)) {
        return res.json({ success: true, msg: '设备已绑定' });
      }
      
      if (keyData.devices.length >= keyData.maxDevices) {
        return res.json({ success: false, msg: '设备数已满' });
      }
      
      keyData.devices.push(hwid);
      await redis.set(`key:${key}`, keyData);
      
      return res.json({ 
        success: true, 
        msg: '绑定成功', 
        deviceNum: keyData.devices.length 
      });
    }
    
    return res.json({ error: '未知操作' });
    
  } catch (error) {
    console.error('Redis Error:', error);
    return res.status(500).json({ 
      error: '服务器错误', 
      msg: error.message,
      hint: '检查 Redis 连接配置' 
    });
  }
}
