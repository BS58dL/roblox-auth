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
    const { action, key, keys, hwid, adminKey, maxDevices = 2, expireDays = 30 } = data || {};

    // ========== 初始化默认卡密 ==========
    if (action === 'init') {
      const defaultKeys = {
        "BS58-VIP-2024": { maxDevices: 2, expireDays: 30 },
        "TEST-001": { maxDevices: 1, expireDays: 7 }
      };
      
      for (const [k, v] of Object.entries(defaultKeys)) {
        const exists = await redis.get(`key:${k}`);
        if (!exists) {
          const expireAt = v.expireDays === 0 ? null : Date.now() + (v.expireDays * 86400000);
          await redis.set(`key:${k}`, {
            devices: [],
            maxDevices: v.maxDevices,
            created: Date.now(),
            expireAt: expireAt
          });
        }
      }
      return res.json({ success: true, msg: '初始化完成' });
    }

    // ========== 管理：添加卡密（支持有效期） ==========
    if (action === 'admin_add') {
      if (adminKey !== ADMIN_PASSWORD) {
        return res.json({ success: false, msg: '管理密码错误' });
      }
      
      const keyList = keys || (key ? [key] : []);
      if (!keyList.length) return res.json({ success: false, msg: '缺少卡密' });
      
      // expireDays: 0=永久, 1=1天, 7=7天, 30=30天, 365=年卡
      const expireAt = parseInt(expireDays) === 0 ? null : Date.now() + (parseInt(expireDays) * 86400000);
      
      const results = [];
      const errors = [];
      
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
            created: Date.now(),
            expireAt: expireAt
          });
          
          results.push({ key: k, expireAt: expireAt });
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

    // ========== 管理：查看所有卡密 ==========
    if (action === 'admin_list') {
      if (adminKey !== ADMIN_PASSWORD) {
        return res.json({ success: false, msg: '管理密码错误' });
      }
      
      const keys = await redis.keys('key:*');
      const list = [];
      
      for (const k of keys) {
        const data = await redis.get(k);
        if (data) {
          const isExpired = data.expireAt && Date.now() > data.expireAt;
          const remainingDays = data.expireAt ? 
            Math.ceil((data.expireAt - Date.now()) / 86400000) : 
            (data.expireAt === null ? -1 : 0); // -1表示永久
          
          list.push({
            key: k.replace('key:', ''),
            boundDevices: data.devices?.length || 0,
            maxDevices: data.maxDevices,
            created: data.created,
            expireAt: data.expireAt,
            isExpired: isExpired,
            remainingDays: remainingDays
          });
        }
      }
      
      return res.json({ success: true, count: list.length, data: list });
    }

    // ========== 管理：删除卡密 ==========
    if (action === 'admin_del') {
      if (adminKey !== ADMIN_PASSWORD) {
        return res.json({ success: false, msg: '管理密码错误' });
      }
      
      const keyList = keys || (key ? [key] : []);
      if (!keyList.length) return res.json({ success: false, msg: '缺少卡密' });
      
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

    // ========== 管理：修改卡密有效期 ==========
    if (action === 'admin_set_expire') {
      if (adminKey !== ADMIN_PASSWORD) {
        return res.json({ success: false, msg: '管理密码错误' });
      }
      
      if (!key) return res.json({ success: false, msg: '缺少卡密' });
      
      const keyData = await redis.get(`key:${key}`);
      if (!keyData) return res.json({ success: false, msg: '卡密不存在' });
      
      const newExpireAt = parseInt(expireDays) === 0 ? null : Date.now() + (parseInt(expireDays) * 86400000);
      keyData.expireAt = newExpireAt;
      await redis.set(`key:${key}`, keyData);
      
      return res.json({ 
        success: true, 
        msg: `已修改有效期`,
        expireAt: newExpireAt
      });
    }

    // ========== 普通验证（检查过期） ==========
    if (!key || !hwid) {
      return res.json({ valid: false, msg: '缺少key或hwid参数' });
    }

    let keyData = await redis.get(`key:${key}`);
    
    if (!keyData) {
      return res.json({ valid: false, msg: '卡密不存在' });
    }

    // 检查是否过期
    if (keyData.expireAt && Date.now() > keyData.expireAt) {
      return res.json({ valid: false, msg: '卡密已过期', expired: true });
    }

    if (action === 'verify') {
      if (keyData.devices?.includes(hwid)) {
        // 计算剩余天数
        const remainingDays = keyData.expireAt ? 
          Math.ceil((keyData.expireAt - Date.now()) / 86400000) : -1;
        return res.json({ 
          valid: true, 
          msg: '验证通过',
          expireAt: keyData.expireAt,
          remainingDays: remainingDays
        });
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
