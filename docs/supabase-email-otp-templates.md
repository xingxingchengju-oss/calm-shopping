# Supabase 邮箱验证码模板

项目的验证码注册和验证码登录都调用 `signInWithOtp()`。Supabase 根据邮件模板内容决定发送：

- `{{ .ConfirmationURL }}`：点击链接（Magic Link）
- `{{ .Token }}`：6 位数字验证码（Email OTP）

为了让新邮箱和已有邮箱都收到数字验证码，需要在 Supabase Dashboard 的：

`Authentication → Email Templates`

分别修改下面两个模板，不能只改其中一个。

## Confirm signup

Subject:

```text
冷静购｜注册验证码
```

Body:

```html
<h2>欢迎来到冷静购</h2>
<p>你的注册验证码是：</p>
<p style="font-size:32px;font-weight:700;letter-spacing:8px;">{{ .Token }}</p>
<p>请在冷静购中输入此验证码。验证码仅可使用一次，请勿转发。</p>
```

## Magic Link

Subject:

```text
冷静购｜登录验证码
```

Body:

```html
<h2>欢迎回到冷静购</h2>
<p>你的登录验证码是：</p>
<p style="font-size:32px;font-weight:700;letter-spacing:8px;">{{ .Token }}</p>
<p>请在冷静购中输入此验证码。验证码仅可使用一次，请勿转发。</p>
```

保存后，用一个从未注册过的邮箱测试。邮件正文应该出现 6 位数字，而不是 “Confirm email address” 链接。

另外确认 `Authentication → Providers → Email` 中允许邮箱注册；如果关闭了新用户注册，客户端即使传入 `shouldCreateUser: true` 也无法创建账号。
