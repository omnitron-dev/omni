import { LocalPeer } from './local-peer';
import { Definition } from './definition';
import { ServiceMetadata } from './types';
import { StreamReference } from './stream-reference';
import { isNetronStream, isNetronService, isServiceReference, isServiceInterface, isServiceDefinition, isNetronStreamReference } from './predicates';

/**
 * ServiceStub представляет собой прокси-объект для экземпляра сервиса в системе Netron.
 * Этот класс обеспечивает прозрачное взаимодействие с удаленными сервисами, 
 * обрабатывая преобразование данных и управляя жизненным циклом сервисных определений.
 * 
 * @class ServiceStub
 * @description Основной класс для работы с сервисами в распределенной системе Netron
 */
export class ServiceStub {
  /** Определение сервиса, содержащее метаданные и спецификацию интерфейса */
  public definition: Definition;

  /**
   * Создает новый экземпляр ServiceStub.
   * 
   * @param {LocalPeer} peer - Локальный пир, с которым ассоциирован данный сервис
   * @param {any} instance - Экземпляр сервиса, который представляет данный заглушка
   * @param {ServiceMetadata | Definition} metaOrDefinition - Метаданные сервиса или готовое определение
   * @throws {Error} Если не удается создать определение сервиса
   */
  constructor(
    public peer: LocalPeer,
    public instance: any,
    metaOrDefinition: ServiceMetadata | Definition
  ) {
    if (isServiceDefinition(metaOrDefinition)) {
      this.definition = metaOrDefinition;
    } else {
      this.definition = new Definition(Definition.nextId(), peer.id, metaOrDefinition);
    }
  }

  /**
   * Устанавливает значение свойства сервиса.
   * 
   * @param {string} prop - Имя свойства для установки
   * @param {any} value - Значение для установки
   * @returns {void}
   * @throws {Error} Если свойство не существует или недоступно для записи
   */
  set(prop: string, value: any) {
    Reflect.set(this.instance, prop, this.processValue(value));
  }

  /**
   * Получает значение свойства сервиса.
   * 
   * @param {string} prop - Имя свойства для получения
   * @returns {any} Обработанное значение свойства
   * @throws {Error} Если свойство не существует или недоступно для чтения
   */
  get(prop: string) {
    return this.processResult(this.instance[prop]);
  }

  /**
   * Вызывает метод сервиса с заданными аргументами.
   * 
   * @param {string} method - Имя метода для вызова
   * @param {any[]} args - Аргументы для передачи в метод
   * @returns {Promise<any>} Обработанный результат вызова метода
   * @throws {Error} Если метод не существует или вызов завершился с ошибкой
   */
  async call(method: string, args: any[]) {
    const processedArgs = this.processArgs(args);
    let result = this.instance[method](...processedArgs);
    if (result instanceof Promise) {
      result = await result;
    }
    return this.processResult(result);
  }

  /**
   * Обрабатывает результат взаимодействия с сервисом.
   * Преобразует специальные типы данных (сервисы, потоки) в соответствующие ссылки.
   * 
   * @param {any} result - Результат для обработки
   * @returns {any} Обработанный результат
   * @private
   */
  private processResult(result: any) {
    if (isNetronService(result) || isServiceInterface(result)) {
      return this.peer.refService(result, this.definition);
    } else if (isNetronStream(result)) {
      return StreamReference.from(result);
    }
    return result;
  }

  /**
   * Обрабатывает массив аргументов для вызова метода.
   * Преобразует каждый аргумент в соответствии с его типом.
   * 
   * @param {any[]} args - Аргументы для обработки
   * @returns {any[]} Обработанные аргументы
   * @private
   */
  private processArgs(args: any[]) {
    return args.map((arg: any) => this.processValue(arg));
  }

  /**
   * Обрабатывает отдельное значение.
   * Преобразует ссылки на сервисы и потоки в соответствующие объекты.
   * 
   * @param {any} obj - Значение для обработки
   * @returns {any} Обработанное значение
   * @private
   */
  private processValue(obj: any) {
    if (isServiceReference(obj)) {
      return this.peer.queryInterfaceByDefId(obj.defId);
    } else if (isNetronStreamReference(obj)) {
      return StreamReference.to(obj, this.peer.netron.peers.get(obj.peerId)!);
    }
    return obj;
  }
}
