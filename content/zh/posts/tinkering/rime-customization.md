---
date: 2025-08-30T22:07:02+08:00
lastmod: 2025-08-30T22:34:29+08:00
title: Rime 输入法折腾笔记
slug: rime-customization
author:
  - viazure
categories:
  - tinkering
tags:
  - tools
  - windows
  - rime
  - weasel
share: true
---

## 前言

近期被 Windows 自带输入法和 Visual Studio 2022 的兼容性问题困扰——每次写中文 commit message 时，输入法都会崩溃，系统卡死。于是转向了开源、高度可定制（折腾）且注重隐私的 Rime 输入法。花了不少时间折腾配置，在此记录下操作过程。

## 一、词库整理

### 1.1 手机通讯录

1. 导出手机通讯录 `.vcf` 文件。
2. 使用 Excel 打开 `.vcf` 文件，使用 `:` 作为分割符号分列，然后筛选出姓名（FN）列。也可以使用各种「vcf 转 Excel/CSV 工具」进行转换，例如 [VCF 转 EXCEL - 免费在线将 VCF 文件转换成 EXCEL](https://cdkm.com/cn/vcf-to-xls)。
3. 复制姓名列，粘贴保存至一个新的 `.txt` 文件中。

### 1.2 自定义短语

由于之前我已在 Windows 自带输入法中维护了一套自定义短语，这里直接通过自带的导出功能导出为 `UserDefinedPhrase.dat` 文件。

![导出自定义短语](https://webpimg.viazure.cc/250830215734186.png)

## 二、生成词库

### 2.1 转换词库

1. 打开 [深蓝词库转换工具](https://github.com/studyzy/imewlconverter)。
2. 选择已保存的姓名 `.txt` 文件，方案选择「无拼音纯汉字」→ 「Rime 中州韵」。

### 2.2 处理自定义短语

1. 打开 [深蓝词库转换工具](https://github.com/studyzy/imewlconverter)。
2. 选择已保存的自定义短语文件 `UserDefinedPhrase.dat`，选择拼音编码方案，我使用的是自然码双拼，故此选择「自然码」。
3. 转换方案选择「Win10 微软五笔（用户自定义短语）」→ 「Gboard - 自然码」。必须选择「Win10 微软五笔（用户自定义短语）」才能正常转换出实际的双拼方案的词库文件。也可以先导出为无拼音纯汉字，再转换为双拼。
4. 将深蓝词库转换工具程序所在目录中转换成功后的 `Gboard词库.zip` 解压，获取词库文本文件 `dictionary.txt`。
5. 用文本编辑器打开此文件，将内容复制到 Excel 中，以便调整列顺序或替换词汇。例如将 `zh-CN` 替换为 Rime 中的权重值 `100`。

## 三、编写 Rime 词库

为了降低配置难度，减少折腾时间，我选择了 [白霜拼音](https://github.com/gaboolic/rime-frost) 作为我的基础词库，所以以下配置内容皆在此基础上进行。

### 3.1 编写「联系人」词库

1. 将 2.1 得到的 `.txt` 文件改名为  `<词库名>.dict.yaml`。并使用文本编辑器打开。
2. 在行首增加词库文件头：

    ```yaml
    ---
    name: contacts # 词库名称
    version: "2025-08-29" # 词库版本
    sort: by_weight # 按权重排序
    columns: # 不写 columns 属性时，默认顺序为：
      - text # 词汇
      - code # 编码
      - weight # 权重
    ```

3. 修改完成后以「UTF-8」编码保存到 `cn_dicts` 文件夹中。

### 3.2 挂载词库

1. 在「用户文件夹」找到原主词库文件 `rime_frost.dict.yaml`，将其复制为一个新文件，并重命名为  `extended.dict.yaml`，用作新的主词库。
2. 使用文件编辑器打开  `extended.dict.yaml`，修改其标题（name）为 `extended`。在 `import_tables` 节点增加 3.1 的「联系人（contacts）」词库，配置示例如下：

    ```yaml
    ---
    name: extended
    version: "2025-08-29"
    import_tables:
      - cn_dicts/contacts # 联系人
      - cn_dicts/8105 # 字表
      - cn_dicts/base # 基础词库
      - cn_dicts/ext # 扩展词库
      - cn_dicts/others # 一些杂项


      # 其他词库
    ```

3. 新建自然码双拼方案（`rime_frost_double_pinyin.schema.yaml`）的补丁文件 `rime_frost_double_pinyin.custom.yaml`，并在其中增加以下内容，用于将词库设置为新建的 `extended`。

    ```yaml
    patch:
      translator/dictionary: extended

    ```

### 3.3 配置自定义短语

「白霜拼音」的双拼自定义短语文件默认为 `custom_phrase_double.txt`，需要手工建立此文件，并将 `custom_phrase.txt` 文件的内容复制过来，修改 `db_name` 为 `custom_phrase_double.txt`。然后将自定义短语按照 `词汇<Tab>编码<Tab>权重` 的格式加入到文件中即可。

## 个人配置

### `weasel.custom.yaml`

皮肤使用的 Windows 11 风格，参考 [官方示例](https://github.com/rime/weasel/wiki/%E7%A4%BA%E4%BE%8B#windows-11-%E9%A3%8E%E6%A0%BC)，做了简单微调。

![输入法皮肤（浅色）.png](https://webpimg.viazure.cc/250830220429087.png)

![输入法皮肤（深色）.png](https://webpimg.viazure.cc/1756562793228.png)

完整配置如下：

```yaml
patch:
  # 字体
  style/font_face: "Microsoft YaHei UI,JetBrains Maple Mono"
  style/label_font_face: "Microsoft YaHei UI,JetBrains Maple Mono"
  style/comment_font_face: "Microsoft YaHei UI,JetBrains Maple Mono"

  # 禁止显示托盘图标
  style/display_tray_icon: false

  # 候选窗样式
  style/+:
    label_format: "%s"
    inline_preedit: true
    font_point: 12
    label_font_point: 10
    comment_font_point: 12
    horizontal: true
    color_scheme: win11light
    color_scheme_dark: win11dark
    layout:
      min_width: 10
      margin_x: 16
      margin_y: 8
      border: 2
      candidate_spacing: 22
      hilite_spacing: 6
      hilite_padding: 2
      hilite_padding_x: 8
      corner_radius: 5
      round_corner: 4
      shadow_radius: 4
  # 候选窗颜色
  preset_color_schemes/+:
    win11light:
      name: "Win11 浅色 / Win11light"
      text_color: 0x191919
      label_color: 0x191919
      hilited_label_color: 0x191919
      back_color: 0xf9f9f9
      border_color: 0x009e5a00
      hilited_mark_color: 0xc06700
      hilited_candidate_back_color: 0xf0f0f0
      shadow_color: 0x20000000
    win11dark:
      name: "Win11 暗色 / Win11Dark"
      text_color: 0xf9f9f9
      label_color: 0xf9f9f9
      back_color: 0x2C2C2C
      hilited_label_color: 0xf9f9f9
      border_color: 0x002C2C2C
      hilited_mark_color: 0xFFC24C
      hilited_candidate_back_color: 0x383838
      shadow_color: 0x20000000
```

### `default.custom.yaml`

```yaml
patch:
  ascii_composer:
    # CapsLock 键切换大小写
    good_old_caps_lock: true
    # CapsLock 键清屏；左、右 Shift 键直接上屏
    switch_key:
      Caps_Lock: clear
      Shift_L: commit_code
      Shift_R: commit_code

  # 候选词个数
  menu/page_size: 7

  # 按键绑定
  key_binder/bindings/+:
    # 候选翻页：逗号上一页（仅在翻页状态下生效）
    - { accept: comma, send: Page_Up, when: paging }
    # 候选翻页：句号下一页（只要候选窗存在就生效）
    - { accept: period, send: Page_Down, when: has_menu }
    # 全角 / 半角切换：Shift+space
    - { accept: "Shift+space", toggle: full_shape, when: always }

  # 方案列表设置为「白霜双拼」
  schema_list:
    - { schema: rime_frost_double_pinyin }

  # 方案选单：清除默认的快捷键，新增 Ctrl+Shift+F4
  switcher/hotkeys: []
  switcher/hotkeys/+:
    - Control+Shift+F4
```

## 其他

若输入时有卡顿或不跟手现象，可尝试禁用 `lua_translator@f/rce_gc`。

- 方法一：在 `rime_frost_xxx.schema.yaml` 中将其注释；
- 方法二：在 `rime_frost_xxx.custom.yaml` 中覆盖 `engine/translators` 列表，移除该项。

    ```yaml
    patch:
      engine/translators:
        # - lua_translator@f/rce_gc  ← 已禁用
    ```

## 一些参考链接

- [全拼词库转双拼词库的方法（适用各种输入法） - 知乎](https://zhuanlan.zhihu.com/p/636562523)
- [自由输入法 RIME 简明配置指南 - 少数派](https://sspai.com/post/84373)
- [Rime 配置：雾凇拼音](https://dvel.me/posts/rime-ice)
- [RIME 输入法+白霜词库真的很好用诶 - V2EX](https://www.v2ex.com/t/1085587)
