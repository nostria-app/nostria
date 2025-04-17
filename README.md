# Nostria

<img src="public/icons/icon-128x128.png" alt="Nostria Logo" width="128" height="128">

Making the Nostr protocol accessible to everyone, with a focus on user experience and performance for global scale.

## Installation

Nostria is accessible as both web app and desktop app.

Web: https://nostria.app

Desktop: https://github.com/sondreb/nostria/releases

## Architecture

The client is built on Angular and Angular Material. It is utilizing Tauri to package the app for desktop users.

Nostria is a client for the Nostr protocol, which is a decentralized social network protocol. It allows users to communicate and share information without relying on a central server. The client is designed to be user-friendly and provide a seamless experience for users.

Nostria implements the usage of the Nostr protocol to ensure maximum decentralization and global scalability, without compromising on user experience. The client is designed to be fast, responsive, and easy to use, with a focus on providing a great user experience.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer) + [Angular Language Service](https://marketplace.visualstudio.com/items?itemName=Angular.ng-template).

## Run from Code

Clone the repository.
Install dependencies:
   ```bash
   npm install
   ```
Start the development server:
   ```bash
   npm start
   ```

Alternative if you want to run the desktop app:
   ```bash
   npm run tauri dev
   ```

## Classifications

* Account - This is accounts of the user within the app.
* Users - This is Nostr users.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.