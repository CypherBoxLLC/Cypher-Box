import React, { useEffect } from 'react';
import { View, Platform } from 'react-native';
import { WebView } from 'react-native-webview';

interface RecaptchaV3Props {
  siteKey: string;
  onToken: (token: string) => void;
}

const RecaptchaV3: React.FC<RecaptchaV3Props> = ({ siteKey, onToken }) => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script src="https://www.google.com/recaptcha/api.js?render=${siteKey}"></script>
      </head>
      <body>
        <script>
          grecaptcha.ready(function() {
            grecaptcha.execute('${siteKey}', {action: 'login'})
              .then(function(token) {
                window.ReactNativeWebView.postMessage(token);
              })
              .catch(function(error) {
                window.ReactNativeWebView.postMessage(JSON.stringify({error: error.message}));
              });
          });
        </script>
      </body>
    </html>
  `;

  const handleMessage = (event: any) => {
    const data = event.nativeEvent.data;
    
    // Check if it's an error
    try {
      const parsed = JSON.parse(data);
      if (parsed.error) {
        console.error('Captcha error:', parsed.error);
        return;
      }
    } catch (e) {
      // Not JSON, so it's the token
      if (data && typeof data === 'string') {
        onToken(data);
      }
    }
  };

  return (
    <View style={{ height: 0, width: 0, opacity: 0 }}>
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        onMessage={handleMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
      />
    </View>
  );
};

export default RecaptchaV3;