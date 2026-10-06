#!/bin/bash
# 滑洲天象七星 —— 手动构建 APK（无 Gradle / 不依赖 Google Maven）
# aapt2 编译资源 -> 链接(含 assets) -> javac 编译 -> d8 转 dex -> zipalign -> apksigner 签名
set -e
# d8(R8 8.2.2) 在 JDK 26 下对 enum / 匿名类会崩溃，源码已规避（全部具名 static 内部类，无 enum）。
# 路径可用环境变量覆盖（CI/他人机器）：JAVA_HOME / ANDROID_HOME / ROOT
export JAVA_HOME=${JAVA_HOME:-$HOME/toolchain/jdk26}
export PATH=$JAVA_HOME/bin:$PATH

ANDROID_HOME=${ANDROID_HOME:-$HOME/Library/Android/sdk}
BT=$ANDROID_HOME/build-tools/34.0.0
PLATFORM=$ANDROID_HOME/platforms/android-34/android.jar
ROOT=${ROOT:-/Users/dujianhua200/qianwen/map-integrated-engineering-camera/android}
OUT=$ROOT/out
SRC=$ROOT/src
RES=$ROOT/res
ASSETS=$ROOT/assets
KEYSTORE=$ROOT/debug.keystore
APK_OUT=$ROOT/滑洲天象七星.apk

echo "==> 检查 SDK 工具"
for tool in $BT/aapt2 $BT/d8 $BT/zipalign $BT/apksigner $PLATFORM; do
  if [ ! -e "$tool" ]; then echo "缺少: $tool"; exit 1; fi
done

rm -rf $OUT && mkdir -p $OUT/res_flats $OUT/gen $OUT/classes $OUT/dex

echo "==> 1) aapt2 编译资源"
$BT/aapt2 compile -o $OUT/res.zip --dir $RES

echo "==> 2) aapt2 链接 (生成 base.apk + R.java，打包 assets)"
$BT/aapt2 link -o $OUT/base.apk -I $PLATFORM \
  --manifest $ROOT/AndroidManifest.xml \
  --java $OUT/gen \
  -A $ASSETS \
  --min-sdk-version 26 --target-sdk-version 34 \
  $OUT/res.zip

echo "==> 3) javac 编译 Java (--release 17, bootclasspath=android.jar)"
find $SRC -name '*.java' > $OUT/srcs.txt
javac --release 17 -cp $PLATFORM -d $OUT/classes @$OUT/srcs.txt $OUT/gen/com/yuntu/geocam/R.java

echo "==> 4) d8 生成 classes.dex (min-api 26)"
CLASSES=$(find $OUT/classes -name '*.class')
$BT/d8 --min-api 26 --output $OUT/dex/ --lib $PLATFORM $CLASSES

echo "==> 5) 将 classes.dex 注入 APK"
cp $OUT/base.apk $OUT/unsigned.apk
( cd $OUT/dex && zip -q -u $OUT/unsigned.apk classes.dex )

echo "==> 6) zipalign 对齐"
$BT/zipalign -f -p 4 $OUT/unsigned.apk $OUT/aligned.apk

echo "==> 7) 签名"
if [ ! -f $KEYSTORE ]; then
  keytool -genkeypair -v -keystore $KEYSTORE -alias androiddebugkey \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass android -keypass android -dname "CN=Android Debug,O=Android,C=US"
fi
$BT/apksigner sign --ks $KEYSTORE --ks-key-alias androiddebugkey \
  --ks-pass pass:android --key-pass pass:android \
  --out "$APK_OUT" $OUT/aligned.apk

echo "==> 完成"
ls -la "$APK_OUT"
$BT/apksigner verify --print-certs "$APK_OUT" | head -8
