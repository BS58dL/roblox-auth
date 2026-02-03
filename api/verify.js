import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const ADMIN_PASSWORD = 'BS58Admin888!';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: '方法不允许' });
  }

  try {
    const data = req.method === 'GET' ? req.query : req.body;
    const { action, key, keys, hwid, adminKey, maxDevices = 2 } = data || {};

    // ========== 批量添加卡密 ==========
    if (action === 'admin_add') {
      if (adminKey !== ADMIN_PASSWORD) {
        return res.json({ success: false, msg: '管理密码错误' });
      }
      
      // 支持单条或批量：key 或 keys 数组
      const keyList = keys || (key ? [key] : []);
      
      if (!keyList.length) {
        return res.json({ success: false, msg: '缺少卡密参数(key或keys)' });
      }
      
      const results = [];
      const errors = [];
      
      // 并发处理
      await Promise.all(keyList.map(async (k) => {
        try {
          const exists = await redis.get(`key:${k}`);
          if (exists) {
            errors.push({ key: k, msg: '卡密已存在' });
            return;
          }
          
          await redis.set(`key:${k}`, {
            devices: [],
            maxDevices: parseInt(maxDevices) || 2,
            created: Date.now()
          });
          
          results.push(k);
        } catch (e) {
          errors.push({ key: k, msg: e.message });
        }
      }));
      
      return res.json({ 
        success: results.length > 0, 
        added: results,
        failed: errors,
        msg: `成功添加 ${results.length} 个，失败 ${errors.length} 个`
      });
    }

    // ========== 批量删除卡密 ==========
    if (action === 'admin_del') {
      if (adminKey !== ADMIN_PASSWORD) {
        return res.json({ success: false, msg: '管理密码错误' });
      }
      
      // 支持单条或批量
      const keyList = keys || (key ? [key] : []);
      
      if (!keyList.length) {
        return res.json({ success: false, msg: '缺少卡密参数(key或keys)' });
      }
      
      // 并发删除
      const deletePromises = keyList.map(k => redis.del(`key:${k}`));
      const results = await Promise.all(deletePromises);
      
      const deletedCount = results.filter(r => r === 1).length;
      
      return res.json({ 
        success: true, 
        deleted: deletedCount,
        total: keyList.length,
        keys: keyList,
        msg: `成功删除 ${deletedCount}/${keyList.length} 个卡密`
      });
    }

    // ========== 管理：查看所有卡密 ==========
    if (action === 'admin_list') {
      if (adminKey !== ADMIN_PASSWORD) {
        return res.json({ success: false, msg: '管理密码错误' });
      }
      
      const redisKeys = await redis.keys('key:*');
      const list = [];
      
      // 批量获取，减少请求次数
      if (redisKeys.length > 0) {
        const values = await redis.mget(...redisKeys);
        
        redisKeys.forEach((k, index) => {
          const data = values[index];
          if (data) {
            list.push({
              key: k.replace('key:', ''),
              boundDevices: data.devices?.length || 0,
              maxDevices: data.maxDevices,
              created: data.created
            });
          }
        });
      }
      
      return res.json({ success: true, count: list.length, data: list });
    }

    // ========== 初始化默认卡密 ==========
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

    // ========== 普通验证 ==========
    if (!key || !hwid) {
      return res.json({ valid: false, msg: '缺少key或hwid参数' });
    }

    let keyData = await redis.get(`key:${key}`);
    
    if (!keyData) {
      return res.json({ valid: false, msg: '卡密不存在' });
    }

    if (action === 'verify') {
      if (keyData.devices?.includes(hwid)) {
        return res.json({ valid: true, msg: '验证通过' });
      } else if (keyData.devices.length < keyData.maxDevices) {
        return res.json({ valid: false, canBind: true, msg: '未绑定' });
      } else {
        return res.json({ valid: false, msg: `已达上限(${keyData.maxDevices}台)` });
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
      
      return res.json({ success: true, msg: '绑定成功', deviceNum: keyData.devices.length });
    }
    
    return res.json({ error: '未知操作' });
    
  } catch (error) {
    console.error('Redis Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
