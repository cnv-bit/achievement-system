import type { ContentCatalog, ContentLayouts } from '../../src/domain/types.ts';

// Release/queue tests must not inherit artwork or new quests from the author draft.
export const packTestCatalog: ContentCatalog = {
  schemaVersion: 2, choiceGroups: [],
  modules: {
    adventure: {
      module: 'adventure', moduleName: '剧情',
      chapters: [1,2,3,4,5].map(chapterNumber => ({chapterId:`chapter.${chapterNumber}`,chapterNumber,chapterName:`第${chapterNumber}章`})),
      storyTrees: [{storyTreeId:'storyTree.beginning',storyTreeName:'启程',chapterId:'chapter.1',rootNodeId:'story.departure'}],
      storyLines: [],
      nodes: [{nodeId:'story.departure',nodeName:'启程',storyTreeId:'storyTree.beginning',condition:'正文明确启程'}],
    },
    bonds: {
      module:'bonds',moduleName:'羁绊',people:[{personId:'person.demo',personName:'示例人物',keywords:['示例人物']}],
      nodes:[
        {nodeId:'bond.demo.reunion',nodeName:'重逢',personId:'person.demo',condition:'双方重逢'},
        {nodeId:'bond.demo.workshop-visit',nodeName:'工坊拜访',personId:'person.demo',condition:'拜访工坊',prerequisiteNodeIds:['bond.demo.reunion']},
      ],
    },
    careers: {
      module:'careers',moduleName:'职业',trees:[{careerTreeId:'careerTree.mage',careerTreeName:'魔法师'}],
      nodes:[
        {nodeId:'career.mage.level-1',nodeName:'一级魔法师',careerTreeId:'careerTree.mage',condition:'一级认可'},
        {nodeId:'career.mage.level-2',nodeName:'二级魔法师',careerTreeId:'careerTree.mage',condition:'二级认可',prerequisiteNodeIds:['career.mage.level-1']},
      ],
    },
    abilities:{module:'abilities',moduleName:'技艺',owners:[],skillTrees:[],combatTrees:[],nodes:[]},
    knowledge:{module:'knowledge',moduleName:'知识',domains:[],topics:[],nodes:[]},
    travel:{module:'travel',moduleName:'旅行',maps:[],regions:[],locations:[]},
    journal:{module:'journal',moduleName:'日记',maxEntryLength:2000},
  },
};

export const packTestLayouts: ContentLayouts = {
  schemaVersion:1,chapters:{},storyTrees:{},bondTrees:{},careerTrees:{},skillTrees:{},combatTrees:{},knowledgeTrees:{},maps:{},
};
