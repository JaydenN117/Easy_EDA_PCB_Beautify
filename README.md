# 圆滑布线 & 泪滴工具 - 熔化PCB

这是一个基于嘉立创EDA的PCB布线优化扩展，提供圆滑布线和自动泪滴生成功能，让你的PCB走线更加流畅美观。

## 扩展特性

- **圆滑布线**：将直角或锐角走线转换为平滑的圆弧过渡，提升PCB美观度和信号质量
- **自动泪滴**：在焊盘、过孔与走线连接处自动生成泪滴，增强连接强度，提高可靠性
- **智能处理**：支持全局处理或选中对象处理，灵活适配不同工作场景
- **可配置参数**：支持自定义圆角半径、单位（mm/mil）、调试模式等参数

## 开发环境配置

### 安装依赖

```bash
npm install
```

### 开发构建

```bash
npm run build
```

## 使用方法

### 1. 圆滑布线

在PCB编辑器中：
1. 选择需要圆滑处理的走线（不选择则处理全部走线）
2. 点击菜单：**熔化PCB → 圆滑布线**
3. 工具将自动识别走线的拐角并生成平滑的圆弧过渡

**特性：**
- 自动检测走线拐点
- 使用圆弧替代直角连接
- 保持原有网络和层级信息
- 支持批量处理

### 2. 生成泪滴

在PCB编辑器中：
1. 选择需要添加泪滴的焊盘/过孔（不选择则处理全部）
2. 点击菜单：**熔化PCB → 生成泪滴**
3. 工具将自动在连接处生成泪滴形状

**特性：**
- 智能识别焊盘、过孔与走线的连接
- 自动生成贝塞尔曲线泪滴
- 避免重复生成（自动清除旧泪滴）
- 保持网络连通性

### 3. 参数设置

点击菜单：**熔化PCB → 设置...**

将打开一个可视化设置窗口（基于内联框架），可配置以下参数：

- **圆角半径**：控制圆弧过渡的半径大小
- **单位**：选择 mm 或 mil
- **自动泪滴**：是否在圆滑布线时同步生成泪滴
- **调试模式**：启用后在控制台输出详细日志

所有设置会自动保存并在下次使用时生效。

## 核心架构

```text
src/
├── index.ts              # 入口文件，导出菜单命令
├── lib/
│   ├── smooth.ts         # 圆滑布线核心逻辑
│   ├── teardrop.ts       # 泪滴生成核心逻辑
│   ├── settings.ts       # 配置管理
│   ├── logger.ts         # 调试日志工具
│   └── math.ts           # 数学工具函数
iframe/
├── settings.html         # 设置界面（内联框架）
├── settings.css          # 设置界面样式
└── settings.js           # 设置界面逻辑
```

### 技术实现

#### 圆滑布线算法
1. 遍历走线段，检测相邻线段的夹角
2. 计算圆弧过渡的起点和终点
3. 使用圆弧图元替代原有的直角连接
4. 保持原有的网络和层级属性

#### 泪滴生成算法
1. 获取焊盘/过孔的连接走线
2. 计算泪滴的控制点位置
3. 使用三次贝塞尔曲线生成泪滴轮廓
4. 转换为填充区域并添加到PCB

## 涉及API

本项目主要使用了以下嘉立创EDA扩展API：

### PCB图元操作
- `eda.pcb_PrimitiveLine.getAll()`: 获取所有导线
- `eda.pcb_PrimitiveLine.get(id)`: 获取指定导线
- `eda.pcb_PrimitiveArc.create()`: 创建圆弧
- `eda.pcb_PrimitivePad.getAll()`: 获取所有焊盘
- `eda.pcb_PrimitiveVia.getAll()`: 获取所有过孔
- `eda.pcb_PrimitiveSolidRegion.create()`: 创建填充区域

### 选择控制

- `eda.pcb_SelectControl.getAllSelectedPrimitives()`: 获取所有选中对象
- `eda.pcb_SelectControl.setSelectedPrimitives()`: 设置选中对象

### 界面交互

- `eda.sys_I18n.text()`: 获取多语言文本
- `eda.sys_Dialog.showInputDialog()`: 显示输入对话框
- `eda.sys_Dialog.showConfirmationMessage()`: 显示确认对话框
- `eda.sys_LoadingAndProgressBar.showLoading()`: 显示加载提示
- `eda.sys_Message.showToastMessage()`: 显示Toast消息
- `eda.sys_IFrame.openIFrame()`: 打开内联框架窗口
- `eda.sys_IFrame.closeIFrame()`: 关闭内联框架窗口

### 数据存储

- `eda.sys_Storage.getExtensionAllUserConfigs()`: 获取用户配置
- `eda.sys_Storage.setExtensionAllUserConfigs()`: 保存用户配置

## 内联框架设置界面

本项目使用了嘉立创EDA的内联框架(IFrame)功能来创建可视化的设置界面，提供更好的用户体验。

**实现特点：**

- 使用 HTML/CSS/JavaScript 创建完全自定义的设置窗口
- 实时预览设置参数
- 美观的开关按钮和单选框
- 所有设置项集中在一个界面中

**文件结构：**

- `iframe/settings.html` - 设置界面结构

**使用方式：**

```typescript
// 打开设置窗口（宽540px，高600px）
eda.sys_IFrame.openIFrame('/iframe/settings.html', 540, 600, 'settings');
```

## 二次开发指南

### 1. 自定义圆角算法

修改 [src/lib/smooth.ts](src/lib/smooth.ts) 中的圆弧计算逻辑：

```typescript
// 调整圆弧半径计算方式
const radius = settings.cornerRadius; // 可替换为动态计算
```

### 2. 自定义泪滴形状

修改 [src/lib/teardrop.ts](src/lib/teardrop.ts) 中的贝塞尔曲线控制点：

```typescript
// 调整泪滴的曲率和长度
const controlPoints = calculateTeardropPoints(pad, track, settings.teardropSize);
```

### 3. 添加新功能

在 [src/index.ts](src/index.ts) 中添加新的导出函数：

```typescript
export async function yourNewFeature() {
	// 实现新功能
}
```

然后在 [extension.json](extension.json) 中注册菜单项：

```json
{
	"id": "YourFeature",
	"title": "新功能",
	"registerFn": "yourNewFeature"
}
```

## 注意事项

1. **备份设计**：建议在使用前备份PCB设计文件
2. **网络检查**：处理后请使用DRC检查网络连通性
3. **性能考虑**：大型PCB（>1000条走线）处理可能需要较长时间
4. **单位统一**：确保设置的单位与PCB单位一致

## 常见问题

**Q: 圆滑布线后走线长度会改变吗？**
A: 会略有增加，因为圆弧的路径长度通常大于直角连接。

**Q: 泪滴会影响阻抗控制吗？**
A: 泪滴的形状会轻微影响局部阻抗，建议在阻抗敏感线路上谨慎使用。

**Q: 可以对差分对使用吗？**
A: 可以，但建议手动检查对称性。

## 开源协议

LGPL-V3

## 技术支持

- 嘉立创EDA官网：https://pro.lceda.cn/
- API文档：https://prodocs.lceda.cn/cn/api/
