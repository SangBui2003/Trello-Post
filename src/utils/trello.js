const path = require('path');
const fs = require('fs');

class TrelloManager {
  constructor(apiKey, apiToken) {
    this.apiKey = apiKey;
    this.apiToken = apiToken;
    this.baseUrl = "https://api.trello.com/1";
  }

  async _get(endpoint) {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    url.searchParams.append('key', this.apiKey);
    url.searchParams.append('token', this.apiToken);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Trello API Error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async getBoards() {
    return this._get('/members/me/boards');
  }

  async getLists(boardId) {
    return this._get(`/boards/${boardId}/lists`);
  }

  async getCards(listId) {
    return this._get(`/lists/${listId}/cards`);
  }

  async getCardAttachments(cardId) {
    return this._get(`/cards/${cardId}/attachments`);
  }

  async downloadImage(imgUrl, filePath) {
    const response = await fetch(imgUrl, {
      method: 'GET',
      headers: {
        'Authorization': `OAuth oauth_consumer_key="${this.apiKey}", oauth_token="${this.apiToken}"`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(filePath, buffer);
    return filePath;
  }
}

module.exports = TrelloManager;
